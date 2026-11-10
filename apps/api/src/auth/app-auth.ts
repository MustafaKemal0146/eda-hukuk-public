// `appAuth` (042 §2; :8000): Better Auth 1.7.7 uygulama örneği. `emailAndPassword` + e-posta doğrulama
// + kısıtlı `admin` eklentisi (yasak alanları ve yasaklı kullanıcıya oturum açtırmama; HTTP uçları
// kapalı) + `organization` + `twoFactor` + `@better-auth/passkey` (P04b). `adminAuth` P27'dedir.
// E-posta geri çağrıları e-postayı göndermez: yalnız `emailEnqueue` (outbox + mühürlü belirteç).
// Oturum DB + Valkey'de (`storeSessionInDatabase`), `cookieCache` KAPALI, `freshAge: 0`; Better Auth
// yerleşik hız sınırı KAPALI (tek uygulayıcı api ara katmanı). Better Auth dışı hatalar (ör. PG
// `EDA01`) işleyiciye fırlatılır (`onAPIError.throw`): ham hata metni konsola/yanıta yazılmaz, eşleme
// `handler.ts`'tedir. `mfa_level` ve `step_up_at` yalnız sunucu kancalarıyla yazılır (`input: false`),
// `mfa_level` düşmez (042 §5.4). Kurulu sürüm doğrulamaları:
//.
import { COMMON_PASSWORD_BASES, RegisterStep1Schema } from '@eda/contracts/api/auth';
import type { InvitableRole } from '@eda/contracts/api/org';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { MfaLevel } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { normalizeEmail, tr_fold } from '@eda/legal/text';
import type { EdaLogger } from '@eda/observability/logger';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { createAccessControl } from 'better-auth/plugins/access';
import { admin } from 'better-auth/plugins/admin';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import { and, eq } from 'drizzle-orm';
import type { RateLimiter } from '../middleware/rate-limit.ts';
import { AUTH_DISABLED_PATHS } from './allowlist.ts';
import { type AppDbAccess, createAuditWriter } from './audit.ts';
import { AUTH_TABLES, type AuthDb, BETTER_AUTH_SCHEMA } from './auth-db.ts';
import {
  COOKIE_ATTRIBUTES,
  COOKIE_PREFIX,
  DONT_REMEMBER_COOKIE,
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_COOKIE_NAME,
  SESSION_COOKIE,
  SESSION_DATA_COOKIE,
  TWO_FACTOR_COOKIE,
} from './cookies.ts';
import { createFailureSampler } from './failure-sampler.ts';
import { createMfaHooks, mfaLevelOfPath, PASSKEY_AUTHENTICATE, raiseMfa } from './hooks/mfa.ts';
import { createOrganizationHooks, INVITATION_INVALID, toApiError } from './hooks/organization.ts';
import { clientIp, truncateIp } from './net.ts';
import { activeMemberships, ensureIndividualOrg, type KekMaterial } from './org-bootstrap.ts';
import { createOrgStore } from './org-store.ts';
import { createPasswordHasher } from './password.ts';
import { organizationPlugin } from './plugins/organization.ts';
import { passkeyPlugin } from './plugins/passkey.ts';
import { twoFactorPlugin } from './plugins/two-factor.ts';
import { authState } from './request-state.ts';
import type { ReplayGuard, SecondaryStorage } from './secondary-storage.ts';

/** Kimlik e-postası kuyruğa alma kapısı (servis katmanındaki `emailEnqueue` bağlanır). */
export interface AuthEmails {
  verifyEmail(user: AuthUserRef, token: string): Promise<void>;
  passwordReset(user: AuthUserRef, token: string): Promise<void>;
  passwordChanged(user: AuthUserRef): Promise<void>;
  registrationAttempt(user: AuthUserRef): Promise<void>;
  /** Büro daveti (P04b): alıcı davet adresidir; satır davet edenin bağlamındadır. */
  invitation(
    inviterId: string,
    invitationId: string,
    role: InvitableRole,
    expiresAt: Date,
  ): Promise<string | null>;
  /** TOTP/passkey ekleme-kaldırma güvenlik bildirimi (045 §3.2 `factor_changed`). */
  factorChanged(
    user: AuthUserRef,
    factor: 'totp' | 'passkey',
    action: 'added' | 'removed',
  ): Promise<void>;
}

export interface AuthUserRef {
  readonly id: string;
  readonly email: string;
}

export interface AppAuthDeps {
  readonly baseURL: string;
  readonly appUrl: string;
  readonly secret: string;
  /** WebAuthn RP kimliği (`PASSKEY_RP_ID` = `APP_DOMAIN`; 002 §4). */
  readonly passkeyRpId: string;
  readonly db: AuthDb;
  readonly storage: SecondaryStorage;
  readonly replay: ReplayGuard;
  readonly rate: RateLimiter;
  readonly kek: KekMaterial;
  readonly appDb: AppDbAccess;
  readonly emails: AuthEmails;
  readonly logger: EdaLogger;
  readonly now?: () => Date;
}

/** Yasaklı kullanıcı iletisi (admin eklentisi; Türkçe, düzeltici). */
export const BANNED_USER_MESSAGE =
  'Hesabınız askıya alınmıştır. Ayrıntı için destek ekibiyle iletişime geçin.';

const SIGN_IN = '/sign-in/email';
const SIGN_UP = '/sign-up/email';
const SET_ACTIVE = '/organization/set-active';
const INVITATION_PATHS: ReadonlySet<string> = new Set([
  '/organization/get-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
]);
/** Kullanıcının az önce kanıt verdiği oturum açılış yolları (`step_up_at = now()`; 042 §6.1). */
const AUTH_PROOF_PATHS: ReadonlySet<string> = new Set([
  SIGN_IN,
  '/verify-email',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  PASSKEY_AUTHENTICATE,
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEAK_PASSWORD_MESSAGE =
  'Parola çok yaygın veya e-posta adresinizi ya da adınızı içeriyor; farklı bir parola seçin.';
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm'];

/**
 * Parola zayıf mı (042 §2.8): e-posta yerel kısmı, tam e-posta veya ad ile aynıysa; gömülü yaygın
 * parola kökü + yalnız rakam/noktalama ise; tek karakter tekrarı veya ardışık dizi (ileri/geri,
 * klavye sırası) ise.
 */
export function isWeakPassword(password: string, email: string, name: string): boolean {
  const p = tr_fold(password);
  const local = tr_fold(email.split('@')[0] ?? '');
  if (p === local || p === tr_fold(name) || p === tr_fold(email)) return true;
  const letters = p.replace(/[^a-z]+/g, '');
  if (letters !== '' && (COMMON_PASSWORD_BASES as readonly string[]).includes(letters)) return true;
  const plain = p.replace(/[^a-z0-9]+/g, '');
  if (plain === '' || /^(.)\1+$/.test(plain)) return true;
  return SEQUENCES.some((seq) => {
    const ring = seq.repeat(4);
    return ring.includes(plain) || [...ring].reverse().join('').includes(plain);
  });
}

const ac = createAccessControl(defaultStatements);
/** Platform rolleri admin eklentisinin rol kaydına bağlanır; HTTP uçları kapalı olduğundan izin yok. */
const PLATFORM_ROLE_DEFS = {
  user: ac.newRole({}),
  support: ac.newRole({}),
  super_admin: ac.newRole({}),
};

function apiError(
  status: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS',
  code: string,
  message: string,
  headers?: Record<string, string>,
): APIError {
  return new APIError(status, { code, message }, headers);
}

export function createAppAuth(deps: AppAuthDeps) {
  const now = deps.now ?? (() => new Date());
  const audit = createAuditWriter(deps.appDb, deps.logger);
  const orgDeps = { db: deps.db, appDb: deps.appDb, kek: deps.kek, audit };
  const store = createOrgStore(deps.db);
  const { users, accounts } = AUTH_TABLES;
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
    store,
    rate: deps.rate,
    replay: deps.replay,
    audit,
    emails: deps.emails,
    now,
    sampleFailure,
  });
  const orgHooks = createOrganizationHooks({ store, appDb: deps.appDb, audit, now });

  /** Davet kabulü ön denetimi (koltuk): dolu ise 409 `SEAT_LIMIT_REACHED` (042 §4.3). */
  const membershipLimit = async (userId: string, orgId: string): Promise<number> => {
    const usage = await deps.appDb.withUserScope({ userId }, async (tx) => {
      const r = await tx.query<{ capacity: number; used: number }>(
        'SELECT capacity, used FROM app.org_seat_usage($1)',
        [orgId],
      );
      return r.rows[0] ?? null;
    });
    if (usage === null) throw INVITATION_INVALID();
    if (usage.used >= usage.capacity) {
      throw toApiError(
        new AppError('SEAT_LIMIT_REACHED', {
          reason: 'seat_limit',
          meta: { seats: usage.capacity, used: usage.used },
        }),
        'CONFLICT',
      );
    }
    return usage.capacity;
  };

  const auth = betterAuth({
    appName: 'E.D.A. Hukuk',
    baseURL: deps.baseURL,
    basePath: '/api/auth',
    secret: deps.secret,
    trustedOrigins: [deps.appUrl],
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      usePlural: true,
      schema: BETTER_AUTH_SCHEMA,
    }),
    secondaryStorage: deps.storage,
    disabledPaths: [...AUTH_DISABLED_PATHS],
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    experimental: { instrumentation: { enabled: false } },
    // Better Auth dışı hata (PG, ağ) işleyiciye fırlatılır; varsayılan davranış ham hatayı konsola
    // yazardı (kişisel veri içerebilir; 002 §23).
    onAPIError: { throw: true },
    logger: {
      level: 'warn',
      // İleti metni e-posta içerebilir: yalnız düzey yazılır (002 §23).
      log: (level) => {
        deps.logger.warn({ event: 'dependency.degraded', dependency: 'better-auth', level });
      },
    },
    user: {
      additionalFields: {
        verificationStatus: { type: 'string', required: false, input: false },
      },
    },
    session: {
      expiresIn: CONFIG_DEFAULTS['auth.sessionIdleHours'] * 3600,
      updateAge: CONFIG_DEFAULTS['auth.sessionUpdateAgeSec'],
      freshAge: 0,
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
      // `activeOrganizationId` `organization` eklentisinin oturum alanıdır (P04b; madde 6).
      additionalFields: {
        mfaLevel: { type: 'string', required: false, input: false },
        stepUpAt: { type: 'date', required: false, input: false },
        surface: { type: 'string', required: false, input: false },
      },
    },
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: CONFIG_DEFAULTS['auth.passwordMinLength'],
      maxPasswordLength: CONFIG_DEFAULTS['auth.passwordMaxLength'],
      password: hasher,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: CONFIG_DEFAULTS['auth.passwordResetTtlMin'] * 60,
      sendResetPassword: async ({ user, token }) => {
        await deps.emails.passwordReset({ id: user.id, email: user.email }, token);
        await audit({
          action: 'auth.password.reset_requested',
          userId: user.id,
          targetType: 'user',
          targetId: user.id,
        });
      },
      onPasswordReset: async ({ user }) => {
        await deps.emails.passwordChanged({ id: user.id, email: user.email });
        await audit({
          action: 'auth.password.changed',
          userId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { via: 'reset' },
        });
      },
      onExistingUserSignUp: async ({ user }) => {
        await deps.emails.registrationAttempt({ id: user.id, email: user.email });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      expiresIn: CONFIG_DEFAULTS['auth.emailVerificationTtlMin'] * 60,
      sendVerificationEmail: async ({ user, token }) => {
        // Davetle açılan hesap zaten doğrulanmıştır (bağlantı davet adresine gitti; 042 §4.2).
        if (user.emailVerified) return;
        await deps.emails.verifyEmail({ id: user.id, email: user.email }, token);
      },
      afterEmailVerification: async (user) => {
        await ensureIndividualOrg(orgDeps, { id: user.id, name: user.name });
      },
    },
    advanced: {
      useSecureCookies: false,
      cookiePrefix: COOKIE_PREFIX,
      defaultCookieAttributes: COOKIE_ATTRIBUTES,
      crossSubDomainCookies: { enabled: false },
      cookies: {
        session_token: { name: SESSION_COOKIE, attributes: COOKIE_ATTRIBUTES },
        session_data: { name: SESSION_DATA_COOKIE, attributes: COOKIE_ATTRIBUTES },
        dont_remember: { name: DONT_REMEMBER_COOKIE, attributes: COOKIE_ATTRIBUTES },
        two_factor: { name: TWO_FACTOR_COOKIE, attributes: COOKIE_ATTRIBUTES },
        [PASSKEY_CHALLENGE_COOKIE_NAME]: {
          name: PASSKEY_CHALLENGE_COOKIE,
          attributes: COOKIE_ATTRIBUTES,
        },
      },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 },
      database: { generateId: false },
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['super_admin', 'support'],
        ac,
        roles: PLATFORM_ROLE_DEFS,
        allowImpersonatingAdmins: false,
        bannedUserMessage: BANNED_USER_MESSAGE,
        schema: { user: { fields: { role: 'platformRole' } } },
      }),
      organizationPlugin({ hooks: orgHooks, emails: deps.emails, membershipLimit }),
      twoFactorPlugin(),
      passkeyPlugin({ rpId: deps.passkeyRpId, origin: deps.appUrl }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const email = normalizeEmail(String(user.email));
            if (email === null) {
              throw apiError(
                'BAD_REQUEST',
                'INVALID_EMAIL',
                'E-posta adresinde Türkçe karakter veya boşluk bulunamaz.',
              );
            }
            const name = String(user.name ?? '').trim();
            if (name.length < 2 || name.length > 100) {
              throw apiError('BAD_REQUEST', 'INVALID_NAME', 'Ad soyad 2-100 karakter olmalıdır.');
            }
            // Davetle kayıt (042 §4.2 adım 1): davet bekliyor, süresi dolmamış ve adres eşitse hesap
            // doğrulanmış açılır; aksi genel hata (davetin varlığı sızmaz).
            const token = (ctx?.body as { invitationToken?: unknown } | undefined)?.invitationToken;
            if (token !== undefined) {
              const inv =
                typeof token === 'string' && UUID_RE.test(token)
                  ? await store.invitationById(token)
                  : null;
              if (
                inv === null ||
                inv.status !== 'pending' ||
                inv.expiresAt.getTime() <= now().getTime() ||
                inv.email !== email
              ) {
                throw INVITATION_INVALID();
              }
              return { data: { ...user, email, name, emailVerified: true } };
            }
            return { data: { ...user, email, name } };
          },
          after: async (user, ctx) => {
            const body = (ctx?.body ?? {}) as Record<string, unknown>;
            if (body.acceptTerms !== true || body.acknowledgePrivacy !== true) return;
            const at = now();
            // Yasal metin sürümleri P29'da (`legal-versions.ts`); zamanlar yazılır.
            await deps.appDb.withUserScope({ userId: user.id }, (tx) =>
              tx.query(
                `INSERT INTO app.user_preferences (user_id, terms_accepted_at, privacy_notice_ack_at)
                 VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING`,
                [user.id, at],
              ),
            );
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const [u] = await deps.db
              .select({
                id: users.id,
                name: users.name,
                email: users.email,
                platformRole: users.platformRole,
                banned: users.banned,
                verificationStatus: users.verificationStatus,
                emailVerified: users.emailVerified,
              })
              .from(users)
              .where(eq(users.id, session.userId));
            if (u === undefined) throw apiError('FORBIDDEN', 'AUTH_FORBIDDEN', 'Oturum açılamadı.');
            if (u.platformRole !== 'user') {
              // Parola girişinde personel hesabı, yanlış parolayla BİREBİR aynı 401'i alır: doğru
              // parola + 403 "personel" yanıtı hem parolanın doğruluğunu hem hesabın personel
              // olduğunu sızdırırdı (D-8). Neden yalnız ek yüzeylerde (passkey vb.) 403 kalır.
              if (ctx?.path === SIGN_IN) {
                throw new APIError('UNAUTHORIZED', {
                  message: 'Invalid email or password',
                  code: 'INVALID_EMAIL_OR_PASSWORD',
                });
              }
              throw apiError(
                'FORBIDDEN',
                'AUTH_FORBIDDEN',
                'Personel hesabıyla uygulama yüzeyinde oturum açılamaz.',
              );
            }
            if (u.banned || u.verificationStatus === 'suspended') {
              throw apiError('FORBIDDEN', 'AUTH_SUSPENDED', BANNED_USER_MESSAGE);
            }
            // Bireysel büro açılışının yeniden denemesi (afterEmailVerification yarıda kaldıysa).
            // `rejected` kullanıcıda `app.member_role()` boş döner (ORG_NOT_MEMBER): tamamlama
            // atlanır, giriş engellenmez (yeniden başvuru ve `GET /me` erişimi; 042 §3.2). Davetle
            // gelen ve daveti bekleyen kullanıcıda bireysel büro AÇILMAZ (042 §4.2 adım 1).
            if (u.emailVerified && !(await store.hasPendingInvitationFor(u.email, now()))) {
              await ensureIndividualOrg(orgDeps, { id: u.id, name: u.name }).catch(
                (err: unknown) => {
                  if (!(err instanceof AppError && err.code === 'ORG_NOT_MEMBER')) throw err;
                },
              );
            }
            const memberships = await activeMemberships(deps.db, u.id);
            // Oturum döndürme (2FA etkinleştirme/kaldırma yeni oturumu eskisinin alanlarıyla açar):
            // `mfa_level` korunur ve yalnız yükselir; aktif büro hâlâ etkin üyelikse korunur.
            const prev = session as typeof session & {
              mfaLevel?: MfaLevel | null;
              stepUpAt?: Date | null;
              activeOrganizationId?: string | null;
            };
            const rotated = prev.mfaLevel !== undefined && prev.mfaLevel !== null;
            const path = ctx?.path;
            const level = mfaLevelOfPath(path);
            const proof = path !== undefined && AUTH_PROOF_PATHS.has(path);
            authState().rotated = rotated;
            const keepOrg =
              rotated &&
              typeof prev.activeOrganizationId === 'string' &&
              memberships.some((m) => m.orgId === prev.activeOrganizationId);
            return {
              data: {
                ...session,
                surface: 'app',
                mfaLevel: raiseMfa(rotated ? prev.mfaLevel : 'none', level),
                stepUpAt: proof || !rotated ? now() : (prev.stepUpAt ?? now()),
                ipAddress: truncateIp(session.ipAddress ?? null),
                activeOrganizationId: keepOrg
                  ? prev.activeOrganizationId
                  : (memberships[0]?.orgId ?? null),
              },
            };
          },
          after: async (session, ctx) => {
            const path = ctx?.path;
            // Döndürme (TOTP etkinleştirme/kaldırma) giriş değildir; 2FA'lı kullanıcının parola
            // adımındaki oturum eklentice silinir, giriş ikinci adım tamamlanınca yazılır.
            if (authState().rotated === true) return;
            if (path === SIGN_IN) {
              const [u] = await deps.db
                .select({ twoFactorEnabled: users.twoFactorEnabled })
                .from(users)
                .where(eq(users.id, session.userId));
              if (u?.twoFactorEnabled === true) return;
            }
            const s = session as typeof session & {
              activeOrganizationId?: string | null;
              mfaLevel?: MfaLevel | null;
            };
            await audit({
              action: 'auth.login.success',
              userId: session.userId,
              orgId: s.activeOrganizationId ?? null,
              targetType: 'session',
              targetId: session.id,
              metadata: {
                method: path === PASSKEY_AUTHENTICATE ? 'passkey' : 'password',
                mfaLevel: s.mfaLevel ?? 'none',
              },
              ipTrunc: truncateIp(session.ipAddress ?? null),
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const headers = ctx.request?.headers ?? new Headers();
        const ip = clientIp(headers);
        if (ctx.path === SIGN_UP) {
          const parsed = RegisterStep1Schema.safeParse(ctx.body);
          if (!parsed.success) {
            throw apiError(
              'BAD_REQUEST',
              'VALIDATION_FAILED',
              'Kayıt bilgileri geçersiz; ad, e-posta, parola ve iki onay kutusunu kontrol edin.',
            );
          }
          if (isWeakPassword(parsed.data.password, parsed.data.email, parsed.data.name)) {
            throw apiError('BAD_REQUEST', 'PASSWORD_TOO_WEAK', WEAK_PASSWORD_MESSAGE);
          }
        }
        if (ctx.path === SIGN_IN) {
          const email = normalizeEmail(String((ctx.body as { email?: unknown })?.email ?? ''));
          if (email !== null) {
            const wait = await deps.rate.backoffRemainingSec(email, ip);
            if (wait > 0) {
              if (sampleFailure(ip)) {
                await audit({
                  action: 'auth.login.failure',
                  targetType: 'session',
                  targetId: null,
                  metadata: { reason: 'backoff' },
                  ipTrunc: truncateIp(ip),
                });
              }
              throw apiError(
                'TOO_MANY_REQUESTS',
                'RATE_LIMITED',
                'Çok fazla deneme yapıldı. Belirtilen süre sonra yeniden deneyin.',
                { 'Retry-After': String(wait) },
              );
            }
          }
        }
        if (ctx.path === '/change-password') {
          const body = ctx.body as { newPassword?: unknown } | undefined;
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (
            s &&
            typeof body?.newPassword === 'string' &&
            isWeakPassword(body.newPassword, s.user.email, s.user.name)
          ) {
            throw apiError('BAD_REQUEST', 'PASSWORD_TOO_WEAK', WEAK_PASSWORD_MESSAGE);
          }
          // Parola değişince diğer tüm oturumlar kapanır (042 §2.5).
          return { context: { body: { ...(ctx.body as object), revokeOtherSessions: true } } };
        }
        if (ctx.path === '/sign-out') {
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s) {
            const sess = s.session as typeof s.session & { activeOrganizationId?: string | null };
            await audit({
              action: 'auth.logout',
              userId: s.user.id,
              orgId: sess.activeOrganizationId ?? null,
              targetType: 'session',
              targetId: s.session.id,
            });
          }
        }
        if (INVITATION_PATHS.has(ctx.path)) {
          // Davet okuma/kabul/ret (042 §4.2): oturum kullanıcısının adresine gelen, bekleyen ve süresi
          // dolmamış davet; aksi tek tip genel hata (varlık ve alıcı ayrışmaz).
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s) {
            const raw =
              ctx.path === '/organization/get-invitation'
                ? (ctx.query as { id?: unknown } | undefined)?.id
                : (ctx.body as { invitationId?: unknown } | undefined)?.invitationId;
            const inv =
              typeof raw === 'string' && UUID_RE.test(raw) ? await store.invitationById(raw) : null;
            if (
              inv === null ||
              inv.status !== 'pending' ||
              inv.expiresAt.getTime() <= now().getTime() ||
              inv.email !== s.user.email
            ) {
              throw INVITATION_INVALID();
            }
          }
        }
        if (ctx.path === SET_ACTIVE) {
          // Aktif büro değişimi (042 §7): hedef büroda etkin üyelik, büro askıda/kapalı değil.
          const body = (ctx.body ?? {}) as { organizationId?: unknown; organizationSlug?: unknown };
          if (body.organizationSlug !== undefined) {
            throw apiError('BAD_REQUEST', 'VALIDATION_FAILED', 'Büro kimliğiyle seçim yapın.');
          }
          const orgId = body.organizationId;
          const s = await getSessionFromCtx(ctx).catch(() => null);
          if (s && typeof orgId === 'string') {
            const m = UUID_RE.test(orgId) ? await store.memberByUser(orgId, s.user.id) : null;
            if (m === null || m.status !== 'active') {
              throw toApiError(new AppError('ORG_NOT_MEMBER'), 'FORBIDDEN');
            }
            const org = await store.org(orgId);
            if (org === null || org.suspendedAt !== null || org.closedAt !== null) {
              throw toApiError(
                new AppError('AUTH_SUSPENDED', { reason: 'org_suspended' }),
                'FORBIDDEN',
              );
            }
          }
        }
        await mfa.before(ctx);
        return undefined;
      }),
      after: createAuthMiddleware(async (ctx) => {
        const headers = ctx.request?.headers ?? new Headers();
        const ip = clientIp(headers);
        const returned = ctx.context.returned;
        if (ctx.path === SIGN_IN) {
          const email = normalizeEmail(String((ctx.body as { email?: unknown })?.email ?? ''));
          if (isAPIError(returned)) {
            const reason =
              returned.statusCode === 401
                ? 'invalid_credentials'
                : (returned.body as { code?: string } | undefined)?.code === 'BANNED_USER'
                  ? 'banned'
                  : null;
            if (reason === 'invalid_credentials' && email !== null) {
              await deps.rate.recordFailure(email, ip);
            }
            if (reason !== null && sampleFailure(ip)) {
              await audit({
                action: 'auth.login.failure',
                targetType: 'session',
                targetId: null,
                metadata: { reason },
                ipTrunc: truncateIp(ip),
              });
            }
          } else if (email !== null) {
            // Parola doğru: 2FA'lı kullanıcıda oturum ikinci adımda açılır (`newSession` boş).
            await deps.rate.resetFailures(email, ip);
          }
          return;
        }
        await mfa.after(ctx);
        if (isAPIError(returned)) return;
        const s = ctx.context.session;
        if (
          (ctx.path === '/revoke-session' ||
            ctx.path === '/revoke-sessions' ||
            ctx.path === '/revoke-other-sessions') &&
          s
        ) {
          await audit({
            action: 'auth.session.revoked',
            userId: s.user.id,
            targetType: 'user',
            targetId: s.user.id,
            metadata: {
              scope:
                ctx.path === '/revoke-session'
                  ? 'one'
                  : ctx.path === '/revoke-sessions'
                    ? 'all'
                    : 'others',
            },
          });
        }
        if (ctx.path === '/change-password' && s) {
          await deps.emails.passwordChanged({ id: s.user.id, email: s.user.email });
          await audit({
            action: 'auth.password.changed',
            userId: s.user.id,
            targetType: 'user',
            targetId: s.user.id,
            metadata: { via: 'change' },
          });
        }
      }),
    },
  });
  return auth;
}

export type AppAuth = ReturnType<typeof createAppAuth>;
