// `auth` şemasına uygulama kaynaklı yazımlar (042 §3.1): yalnız `authDb` ile, `app` yazımından AYRI
// işlemde. `apps/api/src/auth/**` dışı kod `authDb`'ye erişemez; servisler bu fonksiyonları çağırır.
import { and, eq, isNull } from 'drizzle-orm';
import { AUTH_TABLES, type AuthDb } from './auth-db.ts';

const { organizations, users } = AUTH_TABLES;

export interface AuthWrites {
  /** Bayi kodu büroya yalnız boşsa yazılır (geçerlilik `app.validate_partner_code` ile denetlenmiştir). */
  setPartnerCode(orgId: string, code: string): Promise<boolean>;
  /** `rejected` başvurunun yeniden gönderimi: durum `pending_verification`'a döner. */
  resubmitApplication(userId: string): Promise<boolean>;
}

export function createAuthWrites(db: AuthDb, now: () => Date = () => new Date()): AuthWrites {
  return {
    async setPartnerCode(orgId, code) {
      const r = await db
        .update(organizations)
        .set({ partnerCode: code, updatedAt: now() })
        .where(and(eq(organizations.id, orgId), isNull(organizations.partnerCode)))
        .returning({ id: organizations.id });
      return r.length > 0;
    },
    async resubmitApplication(userId) {
      const r = await db
        .update(users)
        .set({ verificationStatus: 'pending_verification', updatedAt: now() })
        .where(and(eq(users.id, userId), eq(users.verificationStatus, 'rejected')))
        .returning({ id: users.id });
      return r.length > 0;
    },
  };
}
