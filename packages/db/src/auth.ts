// `@eda/db/auth` (031 §3, §4.1, §10): Better Auth'un tek DB erişimi, `eda_auth` havuzu (PG_AUTH_*).
// Yalnız apps/api/src/auth/** içe aktarır (dependency-cruiser `db-auth-subpath`). Ham `Pool` dışa
// verilmez; Drizzle örneği (auth şeması tabloları) Better Auth Drizzle bağdaştırıcısına verilir. İki
// Better Auth örneği (uygulama ve admin) aynı havuzu paylaşır.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { loadAuthPoolConfig } from './config/load.ts';
import { createPool } from './pool.ts';
import * as authSchema from './schema/auth.ts';

export type AuthDb = NodePgDatabase<typeof authSchema>;

let pool: pg.Pool | undefined;
let db: AuthDb | undefined;

/** `eda_auth` Drizzle örneği; ilk çağrıda env'den kurulur. */
export function authDb(): AuthDb {
  if (db === undefined) {
    pool = createPool('auth', loadAuthPoolConfig());
    db = drizzle({ client: pool, schema: authSchema });
  }
  return db;
}

/** Havuzu kapatır (süreç kapanışı). */
export async function closeAuthDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  db = undefined;
  await p?.end();
}
