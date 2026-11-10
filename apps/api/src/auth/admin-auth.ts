// `adminAuth` (042 §2.2–§2.5, §10; P27a): yönetim yüzeyi için AYRI Better Auth örneği (:8010). İki giriş
// yolu vardır: passkey VEYA e-posta + parola + TOTP (proje sahibi kararı 2026-10-16: passkey
// zorunluluğu TOTP 2 adımlı doğrulamaya gevşetildi). Parola tek başına oturum açmaz: parola adımı TOTP'si
// etkin personelde yalnız `two_factor` bekleme çerezi verir, oturum TOTP doğrulanınca açılır
// (`mfa_level='totp'`); TOTP'siz hesap parola doğru olsa da yanlış parola ile aynı hatayı alır. Parola
// özeti, `auth.users`/`accounts`/`two_factors` ve kilit/hız sınırı mantığı uygulama kimliğiyle ORTAKTIR.
// Sosyal giriş, kayıt ve "beni hatırla" yoktur. Çerez öneki `__Host-eda-admin`
// (uygulama çerezinden ayrıdır; uygulama oturumu yönetimde, yönetim oturumu uygulamada GEÇMEZ).
// Oturum yalnız `platform_role ∈ {support, super_admin}` ve yasaklı olmayan kullanıcıya açılır.
// Personel hesabı parolasızdır: ilk passkey kaydı `create-staff` ile üretilen tek kullanımlık kayıt
// belirteciyle başlar (`POST /api/auth/staff/enroll`): belirteç kısa ömürlü, `mfa_level='none'`
// oturumu açar (`sessions.surface` CHECK yalnız app|admin kabul eder); bu oturum yalnız passkey kaydı yollarına yeter, `platformGate` onu reddeder. Kayıt
// tamamlanınca kayıt oturumu kapatılır; personel passkey ile giriş yapar (`mfa_level='passkey'`).
import { randomBytes } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import { normalizeEmail } from '@eda/legal/text';
import type { EdaLogger } from '@eda/observability/logger';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { createAccessControl } from 'better-auth/plugins/access';
import { admin } from 'better-auth/plugins/admin';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RateLimiter } from '../middleware/rate-limit.ts';
import { type AppDbAccess, createAuditWriter } from './audit.ts';
import { AUTH_TABLES, type AuthDb, BETTER_AUTH_SCHEMA } from './auth-db.ts';
import { createFailureSampler } from './failure-sampler.ts';
import {
  createMfaHooks,
  PASSKEY_AUTHENTICATE as MFA_PASSKEY_AUTHENTICATE,
  TOTP_VERIFY,
} from './hooks/mfa.ts';
import { toApiError } from './hooks/organization.ts';
import { clientIp, truncateIp } from './net.ts';
import { createOrgStore } from './org-store.ts';
import { createPasswordHasher } from './password.ts';
import { passkeyPlugin } from './plugins/passkey.ts';
import { twoFactorPlugin } from './plugins/two-factor.ts';
import { authState } from './request-state.ts';
import type { ReplayGuard, SecondaryStorage } from './secondary-storage.ts';
import { stepUpValid } from './step-up.ts';

export const ADMIN_COOKIE_PREFIX = '__Host-eda-admin';
export const ADMIN_SESSION_COOKIE = `${ADMIN_COOKIE_PREFIX}.session_token`;
export const ADMIN_PASSKEY_CHALLENGE_COOKIE = `${ADMIN_COOKIE_PREFIX}.passkey_challenge`;
export const ADMIN_TWO_FACTOR_COOKIE = `${ADMIN_COOKIE_PREFIX}.two_factor`;
const COOKIE_ATTRIBUTES = { secure: true, httpOnly: true, sameSite: 'lax', path: '/' } as const;

export const STAFF_ROLES = ['super_admin', 'support'] as const;
const ENROLL_PATH = '/staff/enroll';
const PASSKEY_AUTHENTICATE = MFA_PASSKEY_AUTHENTICATE;
const SIGN_IN = '/sign-in/email';
const PASSKEY_REGISTER = '/passkey/verify-registration';
const PASSKEY_DELETE = '/passkey/delete-passkey';
const ENROLL_SESSION_MIN = 15;
const CREDENTIAL_WINDOW_MS = CONFIG_DEFAULTS['auth.credentialStepUpWindowMin'] * 60_000;
const PASSKEY_REGISTER_OPTIONS = '/passkey/generate-register-options';
/** Kimlik bilgisi değiştiren yollar: yalnız kayıt oturumu ya da taze step-up ile (042 §6). */
const CREDENTIAL_PATHS: ReadonlySet<string> = new Set([
  PASSKEY_REGISTER_OPTIONS,
  PASSKEY_REGISTER,
  PASSKEY_DELETE,
]);
/**
 * Kimlik doğrulama girişimi kabul eden, oturumsuz erişilebilen yönetim yolları: internete açık
 * yüzeyde uygulamadakinden daha sıkı ayrı kova (`admin-auth-ip`, `rateLimit.adminAuthPerIpPerMin`).
 */
export const ADMIN_LOGIN_PATHS: ReadonlySet<string> = new Set([
  SIGN_IN,
  TOTP_VERIFY,
  '/passkey/generate-authenticate-options',
  PASSKEY_AUTHENTICATE,
  ENROLL_PATH,
]);
/** Kayıt oturumunun (`mfa_level='none'`) kullanabildiği tek yollar. */
const ENROLL_SESSION_PATHS: ReadonlySet<string> = new Set([
  PASSKEY_REGISTER_OPTIONS,
  PASSKEY_REGISTER,
  '/get-session',
  '/sign-out',
]);

/** Yönetim yüzeyinde izinli Better Auth yolları (042 §10; listede olmayan yol 404). */
export const ADMIN_AUTH_PATH_ALLOWLIST: Readonly<Record<string, readonly ('GET' | 'POST')[]>> = {
  [ENROLL_PATH]: ['POST'],
  '/get-session': ['GET'],
  '/sign-out': ['POST'],
  '/revoke-other-sessions': ['POST'],
  '/passkey/generate-authenticate-options': ['GET'],
  [PASSKEY_AUTHENTICATE]: ['POST'],
  [SIGN_IN]: ['POST'],
  [TOTP_VERIFY]: ['POST'],
  '/passkey/generate-register-options': ['GET'],
  [PASSKEY_REGISTER]: ['POST'],
  '/passkey/list-user-passkeys': ['GET'],
  [PASSKEY_DELETE]: ['POST'],
};

export function isAllowedAdminAuthRequest(method: string, path: string): boolean {
  const sub = path.startsWith('/api/auth') ? path.slice('/api/auth'.length) : path;
  const allowed = ADMIN_AUTH_PATH_ALLOWLIST[sub];
  return allowed !== undefined && (allowed as readonly string[]).includes(method.toUpperCase());
}

export interface AdminAuthDeps {
  /** `BETTER_AUTH_ADMIN_URL` (= `ADMIN_URL`). */
  readonly baseURL: string;
  readonly adminUrl: string;
  readonly secret: string;
  readonly passkeyRpId: string;
  readonly db: AuthDb;
  readonly storage: SecondaryStorage;
  /** Hesap+IP kademeli bekleme ve adım hız sınırı (uygulama kimliğiyle aynı sınırlayıcı). */
  readonly rate: RateLimiter;
  /** TOTP tekrar kullanım koruması. */
  readonly replay: ReplayGuard;
  readonly appDb: AppDbAccess;
  readonly logger: EdaLogger;
  readonly now?: () => Date;
}

function apiError429(waitSec: number): APIError {
  return toApiError(
    new AppError('RATE_LIMITED', { reason: 'auth_account', meta: { retryAfterSec: waitSec } }),
    'TOO_MANY_REQUESTS',
    { 'Retry-After': String(waitSec) },
  );
}

function apiError(status: 'BAD_REQUEST' | 'FORBIDDEN', code: string, message: string): APIError {
  return new APIError(status, { code, message });
}

const ac = createAccessControl(defaultStatements);
const ROLE_DEFS = {
  user: ac.newRole({}),
  support: ac.newRole({}),
  super_admin: ac.newRole({}),
};

export function createAdminAuth(deps: AdminAuthDeps) {
  const now = deps.now ?? (() => new Date());
  const audit = createAuditWriter(deps.appDb, deps.logger);
  const { users, passkeys, accounts } = AUTH_TABLES;
  const hasher = createPasswordHasher({
    onRehash: async (oldHash, newHash) => {
      await deps.db
        .update(accounts)
        .set({ password: newHash, updatedAt: now() })
        .where(and(eq(accounts.password, oldHash), eq(accounts.providerId, 'credential')));
    },
  });
  const sampleFailure = createFailureSampler(now);
  const mfa = createMfaHooks({
    store: createOrgStore(deps.db),
    rate: deps.rate,
    replay: deps.replay,
    audit,
    emails: { factorChanged: async () => undefined },
    twoFactorCookie: ADMIN_TWO_FACTOR_COOKIE,
    now,
    sampleFailure,
  });
  // Better Auth'un bilinmeyen kullanıcı/yanlış parola yanıtıyla BİREBİR aynı gövde (hesabın varlığı ve
  // uygunluğu yanıttan ayırt edilemez; arayüz kendi Türkçe metnini gösterir).
  const invalidCredentials = () =>
    new APIError('UNAUTHORIZED', {
      message: 'Invalid email or password',
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });

  const staffEnroll = {
    id: 'staff-enroll',
    endpoints: {
      staffEnroll: createAuthEndpoint(
        ENROLL_PATH,
        { method: 'POST', body: z.object({ token: z.string().min(20).max(200) }) },
        async (ctx) => {
          const invalid = () => {
            // Geçersiz/süresi dolmuş belirteç denemesi de denetlenir (kaba kuvvet göstergesi).
            const ip = clientIp(ctx.request?.headers ?? new Headers());
            if (sampleFailure(ip)) {
              void audit({
                action: 'auth.login.failure',
                targetType: 'session',
                targetId: null,
                metadata: { reason: 'enroll_invalid', surface: 'admin' },
                ipTrunc: truncateIp(ip),
              });
            }
            return apiError(
              'BAD_REQUEST',
              'ENROLLMENT_INVALID',
              'Kayıt bağlantısı geçersiz veya süresi dolmuş. Yöneticinizden yeni bağlantı isteyin.',
            );
          };
          const found = await ctx.context.internalAdapter.consumeVerificationValue(
            `staff-enroll:${ctx.body.token}`,
          );
          if (found === null || found === undefined || new Date(found.expiresAt) <= now()) {
            throw invalid();
          }
          const user = await ctx.context.internalAdapter.findUserById(found.value);
          if (user === null || user === undefined) throw invalid();
          const session = await ctx.context.internalAdapter.createSession(user.id, false);
          if (session === null || session === undefined) throw invalid();
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ ok: true });
        },
      ),
    },
  } as const;

  const auth = betterAuth({
    appName: 'E.D.A. Hukuk Yönetim',
    baseURL: deps.baseURL,
    basePath: '/api/auth',
    secret: deps.secret,
    trustedOrigins: [deps.adminUrl],
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      usePlural: true,
      schema: BETTER_AUTH_SCHEMA,
    }),
    secondaryStorage: deps.storage,
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    experimental: { instrumentation: { enabled: false } },
    onAPIError: { throw: true },
    logger: {
      level: 'warn',
      log: (level) => {
        deps.logger.warn({ event: 'dependency.degraded', dependency: 'better-auth-admin', level });
      },
    },
    user: {
      additionalFields: {
        verificationStatus: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: CONFIG_DEFAULTS['auth.adminSessionIdleMin'] * 60,
      updateAge: CONFIG_DEFAULTS['auth.adminSessionUpdateAgeSec'],
      freshAge: 0,
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
      additionalFields: {
        mfaLevel: { type: 'string', required: false, input: false },
        stepUpAt: { type: 'date', required: false, input: false },
        surface: { type: 'string', required: false, input: false },
      },
    },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: CONFIG_DEFAULTS['auth.passwordMinLength'],
      maxPasswordLength: CONFIG_DEFAULTS['auth.passwordMaxLength'],
      password: hasher,
    },
    advanced: {
      useSecureCookies: false,
      cookiePrefix: ADMIN_COOKIE_PREFIX,
      defaultCookieAttributes: COOKIE_ATTRIBUTES,
      crossSubDomainCookies: { enabled: false },
      cookies: {
        session_token: { name: ADMIN_SESSION_COOKIE, attributes: COOKIE_ATTRIBUTES },
        session_data: {
          name: `${ADMIN_COOKIE_PREFIX}.session_data`,
          attributes: COOKIE_ATTRIBUTES,
        },
        dont_remember: {
          name: `${ADMIN_COOKIE_PREFIX}.dont_remember`,
          attributes: COOKIE_ATTRIBUTES,
        },
        two_factor: { name: ADMIN_TWO_FACTOR_COOKIE, attributes: COOKIE_ATTRIBUTES },
        passkey_challenge: {
          name: ADMIN_PASSKEY_CHALLENGE_COOKIE,
          attributes: COOKIE_ATTRIBUTES,
        },
      },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 },
      database: { generateId: false },
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: [...STAFF_ROLES],
        ac,
        roles: ROLE_DEFS,
        allowImpersonatingAdmins: false,
        bannedUserMessage: 'Hesap askıya alınmıştır.',
        schema: { user: { fields: { role: 'platformRole' } } },
      }),
      twoFactorPlugin(),
      passkeyPlugin({ rpId: deps.passkeyRpId, origin: deps.adminUrl }),
      staffEnroll,
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            const [u] = await deps.db
              .select({
                platformRole: users.platformRole,
                banned: users.banned,
                verificationStatus: users.verificationStatus,
                emailVerified: users.emailVerified,
                twoFactorEnabled: users.twoFactorEnabled,
              })
              .from(users)
              .where(eq(users.id, session.userId));
            const staff =
              u !== undefined && (STAFF_ROLES as readonly string[]).includes(u.platformRole);
            const path = ctx?.path;
            const passwordFlow = path === SIGN_IN || path === TOTP_VERIFY;
            if (passwordFlow) {
              // Parola/TOTP yolu: uygun olmayan hesap (personel değil, e-posta doğrulanmamış, TOTP kapalı)
              // yanlış parola ile AYNI hatayı alır; hesabın varlığı ve nedeni dışarı sızmaz, neden
              // yalnız denetim kaydındadır. Askıda/yasaklı hesap da aynı hatayı alır.
              const reason =
                u === undefined || !staff
                  ? 'not_staff'
                  : u.banned || u.verificationStatus === 'suspended'
                    ? 'suspended'
                    : !u.emailVerified
                      ? 'email_unverified'
                      : !u.twoFactorEnabled
                        ? 'totp_not_enabled'
                        : null;
              if (reason !== null) {
                authState().failureAudited = true;
                const ip = clientIp(ctx?.request?.headers ?? new Headers());
                if (sampleFailure(ip)) {
                  await audit({
                    action: 'auth.login.failure',
                    ...(staff ? { userId: session.userId } : {}),
                    targetType: 'session',
                    targetId: null,
                    metadata: { reason, surface: 'admin' },
                    ipTrunc: truncateIp(ip),
                  });
                }
                throw invalidCredentials();
              }
              if (path === SIGN_IN) {
                // Parola adımı: oturum yalnız 2FA eklentisi tarafından hemen silinen geçici kayıttır
                // (`mfa_level='none'`; çerezi gönderilmez, platformGate reddeder).
                return {
                  data: {
                    ...session,
                    surface: 'admin',
                    mfaLevel: 'none',
                    stepUpAt: null,
                    expiresAt: new Date(now().getTime() + 60_000),
                    ipAddress: truncateIp(session.ipAddress ?? null),
                  },
                };
              }
              return {
                data: {
                  ...session,
                  surface: 'admin',
                  mfaLevel: 'totp',
                  stepUpAt: now(),
                  ipAddress: truncateIp(session.ipAddress ?? null),
                },
              };
            }
            if (!staff || u.banned || u.verificationStatus === 'suspended') {
              throw apiError('FORBIDDEN', 'AUTH_FORBIDDEN', 'Oturum açılamadı.');
            }
            if (path === ENROLL_PATH) {
              return {
                data: {
                  ...session,
                  surface: 'admin',
                  mfaLevel: 'none',
                  stepUpAt: null,
                  expiresAt: new Date(now().getTime() + ENROLL_SESSION_MIN * 60_000),
                  ipAddress: truncateIp(session.ipAddress ?? null),
                },
              };
            }
            if (path === PASSKEY_AUTHENTICATE) {
              return {
                data: {
                  ...session,
                  surface: 'admin',
                  mfaLevel: 'passkey',
                  stepUpAt: now(),
                  ipAddress: truncateIp(session.ipAddress ?? null),
                },
              };
            }
            throw apiError('FORBIDDEN', 'AUTH_FORBIDDEN', 'Oturum açılamadı.');
          },
          after: async (session, ctx) => {
            if (ctx?.path !== PASSKEY_AUTHENTICATE && ctx?.path !== TOTP_VERIFY) return;
            const viaTotp = ctx.path === TOTP_VERIFY;
            // Yönetimde tek etkin oturum: yeni giriş (passkey veya parola+TOTP) öncekileri kapatır.
            const internal = ctx.context.internalAdapter;
            for (const old of await internal.listSessions(session.userId)) {
              if (old.token !== session.token) await internal.deleteSession(old.token);
            }
            await audit({
              action: 'auth.login.success',
              userId: session.userId,
              targetType: 'session',
              targetId: session.id,
              metadata: viaTotp
                ? { method: 'password_totp', mfaLevel: 'totp', surface: 'admin' }
                : { method: 'passkey', mfaLevel: 'passkey', surface: 'admin' },
              ipTrunc: truncateIp(session.ipAddress ?? null),
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const ip = clientIp(ctx.request?.headers ?? new Headers());
        if (ctx.path === SIGN_IN) {
          const email = normalizeEmail(String((ctx.body as { email?: unknown })?.email ?? ''));
          if (email === null) throw invalidCredentials();
          const wait = await deps.rate.backoffRemainingSec(email, ip);
          if (wait > 0) {
            if (sampleFailure(ip)) {
              await audit({
                action: 'auth.login.failure',
                targetType: 'session',
                targetId: null,
                metadata: { reason: 'backoff', surface: 'admin' },
                ipTrunc: truncateIp(ip),
              });
            }
            throw apiError429(wait);
          }
        }
        if (ctx.path === TOTP_VERIFY) {
          const cur = await getSessionFromCtx(ctx).catch(() => null);
          if (cur !== null) {
            // Oturumlu TOTP doğrulaması = step-up (oturum yaratmaz). Yalnız tam girişli oturum, TOTP'si
            // etkin hesap; deneme sınırı ve hesap bekleme sayacı uygulama step-up'ıyla aynıdır.
            const level = (cur.session as { mfaLevel?: string | null }).mfaLevel ?? 'none';
            const factors = await createOrgStore(deps.db).mfaFactors(cur.user.id);
            if (level === 'none' || !factors.totp) {
              throw apiError('FORBIDDEN', 'AUTH_FORBIDDEN', 'Bu doğrulama yöntemi kullanılamaz.');
            }
            await deps.rate.enforce(
              'step-up',
              cur.user.id,
              CONFIG_DEFAULTS['rateLimit.stepUpPerUserPerMin'],
              60_000,
            );
            const wait = await deps.rate.backoffRemainingSec(`uid:${cur.user.id}`, ip);
            if (wait > 0) throw apiError429(wait);
          }
        }
        if (ctx.path === TOTP_VERIFY) await mfa.before(ctx);
        const needsSession =
          CREDENTIAL_PATHS.has(ctx.path) ||
          ctx.path.startsWith('/revoke') ||
          ctx.path === '/passkey/list-user-passkeys';
        if (needsSession) {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          const sess = current?.session as
            | (NonNullable<typeof current>['session'] & {
                mfaLevel?: string | null;
                stepUpAt?: Date | string | null;
              })
            | undefined;
          if (sess !== undefined) {
            const enrolling = (sess.mfaLevel ?? 'none') === 'none';
            if (enrolling) {
              // Kayıt oturumu: yalnız passkey kaydı ve en çok ENROLL_SESSION_MIN dakika (kayan
              // yenileme bu sınırı uzatamaz).
              const born = new Date(sess.createdAt).getTime();
              if (
                !ENROLL_SESSION_PATHS.has(ctx.path) ||
                born + ENROLL_SESSION_MIN * 60_000 <= now().getTime()
              ) {
                throw apiError(
                  'FORBIDDEN',
                  'AUTH_FORBIDDEN',
                  'Kayıt oturumu bu işlem için geçerli değil.',
                );
              }
            } else if (CREDENTIAL_PATHS.has(ctx.path)) {
              // Kimlik bilgisi ekleme/silme: genel step-up penceresinden kısa pencere (D-5; girişten
              // hemen sonra çalınan çerezle passkey eklenmesini daraltır).
              const at = sess.stepUpAt == null ? null : new Date(sess.stepUpAt);
              if (!stepUpValid(at, now().getTime(), CREDENTIAL_WINDOW_MS)) {
                throw apiError(
                  'FORBIDDEN',
                  'AUTH_STEP_UP_REQUIRED',
                  'Bu işlem için geçiş anahtarınızla yeniden doğrulayın.',
                );
              }
            }
          }
        }
        if (ctx.path === PASSKEY_DELETE) {
          // Personelin SON passkey'i silinemez (hesap kilitlenir; 042 §10).
          const s = await getSessionFromCtx(ctx).catch(() => null);
          const userId = s?.user.id;
          if (typeof userId === 'string') {
            const [n] = await deps.db
              .select({ n: count() })
              .from(passkeys)
              .where(eq(passkeys.userId, userId));
            if ((n?.n ?? 0) <= 1) {
              throw apiError(
                'BAD_REQUEST',
                'LAST_PASSKEY',
                'Son passkey silinemez; önce yeni bir passkey ekleyin.',
              );
            }
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const ip = clientIp(ctx.request?.headers ?? new Headers());
        const returned = ctx.context.returned;
        if (ctx.path === SIGN_IN) {
          const email = normalizeEmail(String((ctx.body as { email?: unknown })?.email ?? ''));
          if (isAPIError(returned)) {
            if (returned.statusCode === 401 && email !== null) {
              await deps.rate.recordFailure(email, ip);
              if (authState().failureAudited !== true && sampleFailure(ip)) {
                await audit({
                  action: 'auth.login.failure',
                  targetType: 'session',
                  targetId: null,
                  metadata: { reason: 'invalid_credentials', surface: 'admin' },
                  ipTrunc: truncateIp(ip),
                });
              }
            }
          } else if (email !== null) {
            await deps.rate.resetFailures(email, ip);
          }
          return;
        }
        if (ctx.path === TOTP_VERIFY) {
          await mfa.after(ctx);
          const uid = authState().flowUserId;
          if (isAPIError(returned)) {
            const flow = authState().mfaFlow;
            if (flow === 'verify' && uid !== undefined) {
              await deps.rate.recordFailure(`uid:${uid}`, ip);
            }
            if (sampleFailure(ip)) {
              await audit({
                action: 'auth.login.failure',
                ...(uid === undefined ? {} : { userId: uid }),
                targetType: 'session',
                targetId: null,
                metadata: {
                  reason: flow === 'verify' ? 'step_up_totp' : 'totp_invalid',
                  surface: 'admin',
                },
                ipTrunc: truncateIp(ip),
              });
            }
          } else if (authState().mfaFlow === 'verify') {
            const cur = await getSessionFromCtx(ctx).catch(() => null);
            if (cur !== null) {
              const at = now();
              await ctx.context.internalAdapter.updateSession(cur.session.token, { stepUpAt: at });
              await audit({
                action: 'auth.step_up',
                userId: cur.user.id,
                targetType: 'session',
                targetId: cur.session.id,
                metadata: { method: 'totp', surface: 'admin' },
                ipTrunc: truncateIp(ip),
              });
            }
          }
          return;
        }
        if (isAPIError(ctx.context.returned)) {
          if (ctx.path === PASSKEY_AUTHENTICATE) {
            await audit({
              action: 'auth.login.failure',
              targetType: 'session',
              targetId: null,
              metadata: { reason: 'passkey', surface: 'admin' },
              ipTrunc: truncateIp(clientIp(ctx.request?.headers ?? new Headers())),
            });
          }
          return;
        }
        if (ctx.path === PASSKEY_REGISTER) {
          // Kayıt oturumu kapanır: personel yeni passkey ile giriş yapar.
          const s = ctx.context.session;
          if (s) {
            const sess = s.session as typeof s.session & { mfaLevel?: string };
            await audit({
              action: 'auth.passkey.added',
              userId: s.user.id,
              targetType: 'user',
              targetId: s.user.id,
              metadata: { surface: 'admin' },
            });
            if (sess.mfaLevel === 'none') {
              await ctx.context.internalAdapter.deleteSession(s.session.token);
            }
          }
        }
      }),
    },
  });

  /** `create-staff`/`staff-reenroll`: tek kullanımlık kayıt belirteci üretir (yalnız özeti saklanır). */
  async function issueEnrollmentToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const ctx = await auth.$context;
    const expiresAt = new Date(
      now().getTime() + CONFIG_DEFAULTS['auth.staffEnrollmentTtlHours'] * 3_600_000,
    );
    await ctx.internalAdapter.createVerificationValue({
      identifier: `staff-enroll:${token}`,
      value: userId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Kullanıcının tüm oturumlarını DB ve Valkey'den siler; silinen sayıyı döner (yönetim askısı/iptali). */
  async function revokeUserSessions(userId: string): Promise<number> {
    const ctx = await auth.$context;
    const list = await ctx.internalAdapter.listSessions(userId);
    if (list.length > 0) await ctx.internalAdapter.deleteSessions(list.map((s) => s.token));
    return list.length;
  }

  /** Personelin tüm yönetim oturumlarını siler (`staff-reenroll`). */
  async function revokeAllSessions(userId: string): Promise<void> {
    await revokeUserSessions(userId);
  }

  return { auth, issueEnrollmentToken, revokeAllSessions, revokeUserSessions };
}

export type AdminAuth = ReturnType<typeof createAdminAuth>['auth'];
