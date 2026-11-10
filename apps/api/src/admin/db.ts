// `eda_readonly_admin` havuzu (031 §10): yalnız admin yüzeyi ve yönetim komutları.
import { type AdminDb, adminDb, closeAdminDb } from '@eda/db/admin';

export type { AdminDb };

export function adminDbFromEnv(): AdminDb {
  return adminDb();
}

export function closeAdmin(): Promise<void> {
  return closeAdminDb();
}
