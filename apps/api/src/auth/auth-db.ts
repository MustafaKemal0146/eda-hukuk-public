// `authDb` (042 §2.7; 031 §3, §10): Better Auth'un tek DB erişimi `eda_auth` havuzudur. `@eda/db/auth`
// yalnız bu dizinden içe aktarılır (Y-98; dependency-cruiser `db-auth-subpath`). Drizzle bağdaştırıcısı
// çoğul tablo anahtarlarıyla (`usePlural`) ve JS özellik adlarıyla eşlenir; kimlikler DB'de
// `uuidv7()` ile üretilir (`advanced.database.generateId: false`; davet kimliği v4).
import { type AuthDb, authDb } from '@eda/db/auth';
import {
  accounts,
  invitations,
  members,
  organizations,
  passkeys,
  sessions,
  twoFactors,
  users,
  verifications,
} from '@eda/db/schema';

export type { AuthDb };

/** Better Auth Drizzle bağdaştırıcısının gördüğü şema (042 §2.7; P04b: organization/2FA/passkey). */
export const BETTER_AUTH_SCHEMA = {
  users,
  sessions,
  accounts,
  verifications,
  organizations,
  members,
  invitations,
  twoFactors,
  passkeys,
};

/** Hook'ların ve kimlik servislerinin doğrudan okuduğu/yazdığı kimlik tabloları. */
export const AUTH_TABLES = {
  users,
  organizations,
  members,
  accounts,
  sessions,
  invitations,
  twoFactors,
  passkeys,
};

export function defaultAuthDb(): AuthDb {
  return authDb();
}
