// TOTP ve passkey kancaları (042 §5; KK-P04b-7, KK-P04b-12). Better Auth `hooks.before`/`hooks.after`
// içinden yola göre çağrılır:
//  - `two-factor/verify-totp|verify-backup-code`: `trustDevice=true` reddi ("bu cihazı hatırla" yok);
//    akış türü (etkinleştirme / ikinci adım girişi / oturumlu doğrulama); girişte hesap bekleme sayacı
//    (`auth-account`, kullanıcı kimliği anahtarlı); TOTP tekrar kullanım koruması: kod
//    `eda:auth:totp-used:<userId>:<sha256(kod)>` ile `auth.totpReplayTtlSec` süreyle `SET NX`
//    işaretlenir, başarısız doğrulamada işaret kaldırılır. Etkinleştirmede `auth.mfa.enrolled` +
//    `factor_changed`.
//  - `two-factor/disable`: `auth.mfa.removed` + `factor_changed` (step-up ve son yöntem kuralı Hono
//    katmanında, Better Auth'tan önce; `hooks/step-up.ts`).
//  - `passkey/generate-register-options|verify-registration`: kullanıcı başı `auth.maxPasskeys`;
//    `createSession` parametresi reddedilir; taze step-up şarttır (Hono katmanı `hooks/step-up.ts`
//    + burada ikinci kez; yeni passkey kendini ispat etmez, çalınmış çerezle kalıcı arka kapı
//    eklenemez). Kayıt oturumun `mfa_level`ını YÜKSELTMEZ ve `step_up_at`ı YENİLEMEZ (KIMLIK-Y1):
//    yazılım doğrulayıcı kaydeden çalınmış oturum büro MFA kapısını açamaz; güçlü düzey yalnız
//    passkey ile GİRİŞTE (`verify-authentication`) kazanılır. `auth.passkey.added` + `factor_changed`.
//  - `passkey/verify-authentication`: imza sayacı geriye giderse (klon şüphesi) giriş reddedilir,
//    `auth.login.failure` (`reason: passkey_counter`).
//  - `passkey/delete-passkey`: `auth.passkey.removed` + `factor_changed`.
// Kod, parola ve belirteç günlüğe/denetime yazılmaz; anahtar yalnız özettir.
import { createHash } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { MfaLevel } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { createAuthMiddleware } from 'better-auth/api';
import { APIError, getSessionFromCtx, isAPIError } from 'better-auth/api';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import type { AuthEmails } from '../app-auth.ts';
import type { AuditWriter } from '../audit.ts';
import { TWO_FACTOR_COOKIE } from '../cookies.ts';
import { clientIp, truncateIp } from '../net.ts';
import type { OrgStore } from '../org-store.ts';
import { authState } from '../request-state.ts';
import type { ReplayGuard } from '../secondary-storage.ts';
import { stepUpValid } from '../step-up.ts';
import { toApiError } from './organization.ts';

export type AuthHookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export const TOTP_VERIFY = '/two-factor/verify-totp';
export const BACKUP_VERIFY = '/two-factor/verify-backup-code';
export const TOTP_DISABLE = '/two-factor/disable';
export const PASSKEY_REGISTER_OPTIONS = '/passkey/generate-register-options';
export const PASSKEY_REGISTER = '/passkey/verify-registration';
export const PASSKEY_AUTHENTICATE = '/passkey/verify-authentication';
export const PASSKEY_DELETE = '/passkey/delete-passkey';

const MFA_RANK: Readonly<Record<MfaLevel, number>> = { none: 0, totp: 1, passkey: 2 };

/** `mfa_level` yalnız yükselir (042 §5.4). */
export function raiseMfa(current: MfaLevel | null | undefined, next: MfaLevel): MfaLevel {
  const cur = current ?? 'none';
  return MFA_RANK[next] > MFA_RANK[cur] ? next : cur;
}

/** Oturum açan yola göre MFA düzeyi (042 §5.4): TOTP/yedek kod -> totp, passkey -> passkey. */
export function mfaLevelOfPath(path: string | undefined): MfaLevel {
  if (path === TOTP_VERIFY || path === BACKUP_VERIFY) return 'totp';
  if (path === PASSKEY_AUTHENTICATE) return 'passkey';
  return 'none';
}

/** WebAuthn `authenticatorData` (base64url) imza sayacı: bayt 33..36, büyük uçlu. */
export function authenticatorCounter(authenticatorData: unknown): number | null {
  if (typeof authenticatorData !== 'string') return null;
  const b = Buffer.from(authenticatorData, 'base64url');
  return b.length >= 37 ? b.readUInt32BE(33) : null;
}

export interface MfaHookDeps {
  readonly store: OrgStore;
  readonly rate: RateLimiter;
  readonly replay: ReplayGuard;
  readonly audit: AuditWriter;
  readonly emails: Pick<AuthEmails, 'factorChanged'>;
  /** 2FA bekleme çerezi adı (varsayılan uygulama çerezi; yönetim kendi önekini verir). */
  readonly twoFactorCookie?: string;
  readonly now: () => Date;
  /** `auth.login.failure` örneklemesi (IP başına dakikalık üst sınır). */
  readonly sampleFailure: (ip: string) => boolean;
}

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const accountKey = (userId: string) => `uid:${userId}`;

const invalidCode = () =>
  new APIError('UNAUTHORIZED', {
    code: 'INVALID_CODE',
    message: 'Kod geçersiz veya daha önce kullanılmış. Uygulamadaki yeni kodu girin.',
  });

function bodyOf(ctx: AuthHookCtx): Record<string, unknown> {
  const b = ctx.body as unknown;
  return b !== null && typeof b === 'object' ? (b as Record<string, unknown>) : {};
}

export function createMfaHooks(deps: MfaHookDeps) {
  async function resolveFlowUser(ctx: AuthHookCtx) {
    const s = await getSessionFromCtx(ctx).catch(() => null);
    if (s) return { userId: s.user.id, signin: false };
    const signed = await ctx.getSignedCookie(
      deps.twoFactorCookie ?? TWO_FACTOR_COOKIE,
      ctx.context.secret,
    );
    if (typeof signed !== 'string' || signed === '') return null;
    const v = await ctx.context.internalAdapter.findVerificationValue(signed);
    return v === null || v === undefined ? null : { userId: v.value, signin: true };
  }

  async function before(ctx: AuthHookCtx): Promise<void> {
    const path = ctx.path;
    const body = bodyOf(ctx);
    const ip = clientIp(ctx.request?.headers ?? new Headers());
    if (path === TOTP_VERIFY || path === BACKUP_VERIFY) {
      if (body.trustDevice === true) {
        throw new APIError('BAD_REQUEST', {
          code: 'TRUST_DEVICE_DISABLED',
          message: '"Bu cihazı hatırla" seçeneği kullanılamaz; her girişte ikinci adım istenir.',
        });
      }
      const flow = await resolveFlowUser(ctx);
      if (flow === null) return;
      const state = authState();
      state.flowUserId = flow.userId;
      if (flow.signin) {
        state.mfaFlow = 'signin';
        const wait = await deps.rate.backoffRemainingSec(accountKey(flow.userId), ip);
        if (wait > 0) {
          throw toApiError(
            new AppError('RATE_LIMITED', {
              reason: 'auth_account',
              meta: { retryAfterSec: wait },
            }),
            'TOO_MANY_REQUESTS',
            { 'Retry-After': String(wait) },
          );
        }
      } else {
        const factors = await deps.store.mfaFactors(flow.userId);
        state.mfaFlow = path === TOTP_VERIFY && !factors.totp ? 'enroll' : 'verify';
      }
      if (path === TOTP_VERIFY && typeof body.code === 'string') {
        const key = `${flow.userId}:${sha256(body.code)}`;
        let claimed: boolean;
        try {
          claimed = await deps.replay.claim(key, CONFIG_DEFAULTS['auth.totpReplayTtlSec']);
        } catch {
          throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
        }
        if (!claimed) throw invalidCode();
        state.replayKey = key;
      }
      return;
    }
    if (path === PASSKEY_REGISTER_OPTIONS || path === PASSKEY_REGISTER) {
      if (path === PASSKEY_REGISTER && body.createSession === true) {
        throw new APIError('BAD_REQUEST', {
          code: 'VALIDATION_FAILED',
          message: 'Passkey kaydı oturum açmaz; geçerli oturumla kaydedin.',
        });
      }
      const s = await getSessionFromCtx(ctx).catch(() => null);
      if (!s) return;
      const stepUpAt = (s.session as typeof s.session & { stepUpAt?: Date | string | null })
        .stepUpAt;
      if (!stepUpValid(stepUpAt == null ? null : new Date(stepUpAt), deps.now().getTime())) {
        throw toApiError(
          new AppError('AUTH_STEP_UP_REQUIRED', { actions: ['step_up'] }),
          'FORBIDDEN',
        );
      }
      const f = await deps.store.mfaFactors(s.user.id);
      if (f.passkeys >= CONFIG_DEFAULTS['auth.maxPasskeys']) {
        throw new APIError('FORBIDDEN', {
          code: 'PASSKEY_LIMIT_REACHED',
          message: 'En çok passkey sayısına ulaştınız; yenisini eklemeden önce birini kaldırın.',
        });
      }
      return;
    }
    if (path === PASSKEY_AUTHENTICATE) {
      const resp = body.response as { id?: unknown; response?: { authenticatorData?: unknown } };
      if (typeof resp?.id !== 'string') return;
      const pk = await deps.store.passkeyByCredential(resp.id);
      const next = authenticatorCounter(resp.response?.authenticatorData);
      if (pk === null || next === null) return;
      // Sayaç destekleyen doğrulayıcıda sayaç artmalıdır (0/0: sayaçsız doğrulayıcı).
      if ((pk.counter > 0 || next > 0) && next <= pk.counter) {
        if (deps.sampleFailure(ip)) {
          await deps.audit({
            action: 'auth.login.failure',
            targetType: 'session',
            targetId: null,
            metadata: { reason: 'passkey_counter' },
            ipTrunc: truncateIp(ip),
          });
        }
        throw new APIError('UNAUTHORIZED', {
          code: 'PASSKEY_COUNTER',
          message: 'Passkey doğrulanamadı. Cihazınızı kontrol edin veya başka bir yöntemle girin.',
        });
      }
    }
  }

  async function after(ctx: AuthHookCtx): Promise<void> {
    const path = ctx.path;
    const returned = ctx.context.returned;
    const failed = isAPIError(returned);
    const ip = clientIp(ctx.request?.headers ?? new Headers());
    const state = authState();
    if (path === TOTP_VERIFY || path === BACKUP_VERIFY) {
      const uid = state.flowUserId;
      if (failed) {
        if (state.replayKey !== undefined) await deps.replay.release(state.replayKey);
        if (state.mfaFlow === 'signin' && uid !== undefined) {
          await deps.rate.recordFailure(accountKey(uid), ip);
        }
        return;
      }
      if (uid === undefined) return;
      if (state.mfaFlow === 'signin') await deps.rate.resetFailures(accountKey(uid), ip);
      if (state.mfaFlow === 'enroll' && path === TOTP_VERIFY) {
        const u = await deps.store.user(uid);
        await deps.audit({
          action: 'auth.mfa.enrolled',
          userId: uid,
          targetType: 'user',
          targetId: uid,
          metadata: { type: 'totp' },
        });
        if (u !== null)
          await deps.emails.factorChanged({ id: uid, email: u.email }, 'totp', 'added');
      }
      return;
    }
    if (failed) {
      if (path === PASSKEY_AUTHENTICATE && deps.sampleFailure(ip)) {
        await deps.audit({
          action: 'auth.login.failure',
          targetType: 'session',
          targetId: null,
          metadata: { reason: 'invalid_credentials' },
          ipTrunc: truncateIp(ip),
        });
      }
      return;
    }
    const s = ctx.context.session;
    if (path === TOTP_DISABLE && s) {
      await deps.audit({
        action: 'auth.mfa.removed',
        userId: s.user.id,
        targetType: 'user',
        targetId: s.user.id,
        metadata: { type: 'totp' },
      });
      await deps.emails.factorChanged({ id: s.user.id, email: s.user.email }, 'totp', 'removed');
      return;
    }
    if (path === PASSKEY_REGISTER && s) {
      const added = returned as { id?: unknown } | undefined;
      await deps.audit({
        action: 'auth.passkey.added',
        userId: s.user.id,
        targetType: 'passkey',
        targetId: typeof added?.id === 'string' ? added.id : null,
        metadata: { passkeyId: typeof added?.id === 'string' ? added.id : null },
      });
      await deps.emails.factorChanged({ id: s.user.id, email: s.user.email }, 'passkey', 'added');
      return;
    }
    if (path === PASSKEY_DELETE && s) {
      const id = bodyOf(ctx).id;
      await deps.audit({
        action: 'auth.passkey.removed',
        userId: s.user.id,
        targetType: 'passkey',
        targetId: typeof id === 'string' ? id : null,
        metadata: { passkeyId: typeof id === 'string' ? id : null },
      });
      await deps.emails.factorChanged({ id: s.user.id, email: s.user.email }, 'passkey', 'removed');
    }
  }

  return { before, after };
}
