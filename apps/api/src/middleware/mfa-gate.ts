// `mfaGate` (040 §5.1 adım 13, §5.10; 042 §5.1; KK-P04b-6): `mfa: exempt` rotalar ve aktif büro
// bağlamı olmayan istekler atlanır; oturum `mfa_level = 'none'` iken politika MFA istiyorsa 403
// `AUTH_MFA_REQUIRED` (`actions: ["enroll_totp","enroll_passkey"]`, `reason`). Politika üyelik ve
// `org_settings.mfa_required_all` değerini `tenant` ara katmanının her istekte DB'den okuduğu
// bağlamdan alır (önbellek yok). Sohbet mesajı gibi veri sınıfı çalışma zamanında belli olan akışlar
// `requireMfaForClientData()` çağırır.
import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import { type MfaDecision, mfaRequired } from '../auth/index.ts';
import type { SessionVar, SurfaceEnv, TenantVar } from '../context/types.ts';

function decide(
  session: SessionVar | undefined,
  tenant: TenantVar | null | undefined,
  clientData: boolean,
): MfaDecision {
  if (
    session === undefined ||
    session.mfaLevel !== 'none' ||
    tenant === null ||
    tenant === undefined
  ) {
    return { required: false, reason: null };
  }
  return mfaRequired(
    {
      memberRole: tenant.memberRole,
      orgKind: tenant.orgKind,
      mfaRequiredAll: tenant.mfaRequiredAll,
    },
    clientData,
  );
}

function deny(d: MfaDecision): AppError {
  return new AppError('AUTH_MFA_REQUIRED', {
    ...(d.reason === null ? {} : { reason: d.reason }),
    actions: ['enroll_totp', 'enroll_passkey'],
  });
}

export function mfaGate(): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined || meta.mfa === 'exempt') return next();
    const d = decide(c.get('session'), c.get('tenant'), meta.clientData);
    if (d.required) throw deny(d);
    await next();
  };
}

/**
 * Müvekkil verisi anı (042 §5.1): servis veri sınıfı `client`/`case` çözüldüğünde çağırır (P09/P10).
 * MFA gerekiyorsa 403 `AUTH_MFA_REQUIRED` (`mfa_required_client_data` vb.) fırlatır.
 */
export function requireMfaForClientData(c: {
  get(key: 'session'): SessionVar | undefined;
  get(key: 'tenant'): TenantVar | null | undefined;
}): void {
  const d = decide(c.get('session'), c.get('tenant'), true);
  if (d.required) throw deny(d);
}
