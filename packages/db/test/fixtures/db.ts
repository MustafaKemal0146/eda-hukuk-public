// Test bağlantıları (032 §12): rol başına istemci ve havuz. Parolalar infra/secrets/dev dosyalarından
// okunur ve hiçbir yere yazılmaz. `pg` yalnız bu pakette içe aktarılır (Y-98). Kiracı bağı yalnız
// src/tenant.ts createTenantRunner ile kurulur (set_config testlerde yazılmaz; 031 §4.5).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { inject } from 'vitest';
import { poolTypes } from '../../src/pool.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string };
  }
}

export const SECRETS_DIR = fileURLToPath(
  new URL('../../../../infra/secrets/dev/', import.meta.url),
);

export const ROLE_SECRET = {
  postgres: 'pg_superuser_password',
  eda_owner: 'pg_owner_password',
  eda_auth: 'pg_auth_password',
  eda_app: 'pg_app_password',
  eda_worker: 'pg_worker_password',
  eda_jobs: 'pg_jobs_password',
  eda_readonly_admin: 'pg_readonly_admin_password',
  eda_backup: 'pg_backup_password',
  eda_monitor: 'pg_monitor_password',
} as const;
export type LoginRole = keyof typeof ROLE_SECRET;

export function secretPath(name: string): string {
  return `${SECRETS_DIR}${name}`;
}

export function rolePassword(role: LoginRole): string {
  return readFileSync(secretPath(ROLE_SECRET[role]), 'utf8').trim();
}

export function pgTarget(): { host: string; port: number; database: string } {
  return inject('pg');
}

/** Bağlanmamış istemci; `password` verilmezse rolün sır dosyası kullanılır. */
export function makeClient(user: string, password?: string): pg.Client {
  const t = pgTarget();
  const client = new pg.Client({
    host: t.host,
    port: t.port,
    database: t.database,
    user,
    password: password ?? rolePassword(user as LoginRole),
    application_name: 'eda-db-test',
    connectionTimeoutMillis: 5000,
  });
  // Sunucu tarafından koparılan bağlantı (ör. boşta işlem zaman aşımı) süreci düşürmesin.
  client.on('error', () => undefined);
  return client;
}

export async function connect(user: LoginRole): Promise<pg.Client> {
  const c = makeClient(user);
  await c.connect();
  return c;
}

export const ownerDb = () => connect('eda_owner');
export const authDb = () => connect('eda_auth');
export const appDb = () => connect('eda_app');
export const workerDb = () => connect('eda_worker');
export const jobsDb = () => connect('eda_jobs');
export const adminDb = () => connect('eda_readonly_admin');

/** Hata nesnesinden SQLSTATE ve kısıt adı. */
export function pgCode(err: unknown): { code?: string; constraint?: string } {
  const e = err as { code?: unknown; constraint?: unknown };
  return {
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof e.constraint === 'string' ? { constraint: e.constraint } : {}),
  };
}

/** Deyimin belirtilen SQLSTATE ile başarısız olduğunu savepoint içinde doğrular. */
export async function sqlError(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ code?: string; constraint?: string }> {
  await client.query('SAVEPOINT expect_error');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expect_error');
    return pgCode(err);
  }
  await client.query('RELEASE SAVEPOINT expect_error');
  return {};
}

/**
 * Rol başına pg havuzu (createTenantRunner için; 032 §12). `json` ayrıştırıcısı uygulama havuzuyla
 * aynıdır (src/pool.ts poolTypes). Çağıran `end()` ile kapatır.
 */
export function makePool(role: LoginRole, max = 2): pg.Pool {
  const t = pgTarget();
  const pool = new pg.Pool({
    host: t.host,
    port: t.port,
    database: t.database,
    user: role,
    password: rolePassword(role),
    max,
    application_name: 'eda-db-test',
    connectionTimeoutMillis: 5000,
    types: poolTypes,
  });
  pool.on('error', () => undefined);
  return pool;
}
