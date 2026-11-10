// Better Auth şema üretimi için geçici yapılandırma (P03a; 042 §2.3, 030 §3.1).
// Yalnız `auth generate --adapter drizzle --dialect postgresql` girdisidir: çalışma zamanı
// yapılandırması apps/api/src/auth'tadır (P04a) ve bu dosyayı içe aktarmaz. CLI çıktısı doğrudan
// commit edilmez; 030 §3.1 eşlemesiyle src/schema/auth.ts'e elle alınır.
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { admin, organization, twoFactor } from 'better-auth/plugins';

export const auth = betterAuth({
  advanced: { database: { generateId: false } },
  user: {
    additionalFields: {
      verificationStatus: { type: 'string', required: true, input: false },
    },
  },
  session: {
    additionalFields: {
      mfaLevel: { type: 'string', required: true, input: false },
      stepUpAt: { type: 'date', required: false, input: false },
      surface: { type: 'string', required: true, input: false },
    },
  },
  plugins: [
    organization({
      schema: {
        organization: {
          additionalFields: {
            kind: { type: 'string', required: true, input: false },
            partnerCode: { type: 'string', required: false, input: false },
            suspendedAt: { type: 'date', required: false, input: false },
            closedAt: { type: 'date', required: false, input: false },
          },
        },
        member: {
          additionalFields: {
            status: { type: 'string', required: true, input: false },
          },
        },
      },
    }),
    twoFactor(),
    passkey(),
    admin({
      defaultRole: 'user',
      schema: { user: { fields: { role: 'platformRole' } } },
    }),
  ],
});
