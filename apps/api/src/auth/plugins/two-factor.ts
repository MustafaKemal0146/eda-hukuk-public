// `twoFactor` eklentisi (yalnız `appAuth`; 042 §2.3, §5.2; P04b). Etkinleştirmede ilk kod doğrulanır
// (`skipVerificationOnEnable: false`), yedek kodlar `auth.backupCodeCount` adet ve 10 karakterdir.
// "Bu cihazı hatırla" (`trustDevice`) yoktur: parametre `hooks/mfa.ts`'te reddedilir. Hesap kilitleme
// yoktur (`accountLockout` kapalı; 042 §11.2): deneme sınırı api `auth-ip`/`auth-account` ve ikinci
// adım meydan okuması başına eklentinin 5 deneme sınırıdır. 2FA bekleme çerezi
// `__Host-eda.two_factor` (ömür `auth.twoFactorPendingMin`).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { twoFactor } from 'better-auth/plugins/two-factor';

export const TOTP_ISSUER = 'E.D.A. Hukuk';
export const BACKUP_CODE_LENGTH = 10;

export function twoFactorPlugin() {
  return twoFactor({
    issuer: TOTP_ISSUER,
    totpOptions: { digits: 6, period: 30 },
    backupCodeOptions: {
      amount: CONFIG_DEFAULTS['auth.backupCodeCount'],
      length: BACKUP_CODE_LENGTH,
    },
    skipVerificationOnEnable: false,
    twoFactorCookieMaxAge: CONFIG_DEFAULTS['auth.twoFactorPendingMin'] * 60,
    accountLockout: { enabled: false },
  });
}
