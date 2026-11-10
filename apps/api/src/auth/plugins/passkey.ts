// `@better-auth/passkey` (yalnız `appAuth`; 042 §2.3, §5.3; P04b): `rpID = PASSKEY_RP_ID`, origin
// `APP_URL`, kullanıcı doğrulaması zorunlu (kayıt ve girişte `userVerified` sunucuda denetlenir),
// `residentKey: preferred`, attestation `none` (eklenti sabiti). Meydan okuma çerezi
// `__Host-eda.passkey_challenge` (5 dk). Kullanıcı başı üst sınır ve sayaç geriye gitme reddi
// `hooks/mfa.ts`'tedir.
import { passkey } from '@better-auth/passkey';
import { APIError } from 'better-auth/api';
import { PASSKEY_CHALLENGE_COOKIE_NAME } from '../cookies.ts';

export const PASSKEY_RP_NAME = 'E.D.A. Hukuk';

const UV_REQUIRED = () =>
  new APIError('BAD_REQUEST', {
    code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
    message: 'Passkey için cihazınızda kullanıcı doğrulaması (PIN veya biyometri) gereklidir.',
  });

export function passkeyPlugin(opts: { readonly rpId: string; readonly origin: string }) {
  return passkey({
    rpID: opts.rpId,
    rpName: PASSKEY_RP_NAME,
    origin: opts.origin,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    advanced: { webAuthnChallengeCookie: PASSKEY_CHALLENGE_COOKIE_NAME },
    registration: {
      afterVerification: ({ verification }) => {
        if (verification.registrationInfo?.userVerified !== true) throw UV_REQUIRED();
      },
    },
    authentication: {
      afterVerification: ({ verification }) => {
        if (verification.authenticationInfo.userVerified !== true) throw UV_REQUIRED();
      },
    },
  });
}
