// pg havuz fabrikası (031 §10): rol başına tek havuz; parola yalnız `*_FILE` sır dosyasından okunur
// ve hiçbir yere yazılmaz. Ham `Pool` paket dışına verilmez: uygulama yalnız `withTenant` /
// `withUserScope` / `withNoTenant` sarmalayıcılarını görür (src/index.ts). `json` (OID 114) bu
// havuzda ham dize döner (bayt kararlılığı, 030 Tuzak 9); `jsonb` (OID 3802) varsayılan ayrıştırıcıda
// kalır. Ayrıştırıcı süreç geneline değil yalnız bu havuzlara uygulanır.
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import pg from 'pg';

export const POOL_ROLES = ['app', 'auth', 'admin', 'worker', 'jobs'] as const;
export type PoolRole = (typeof POOL_ROLES)[number];

export interface PoolConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  /** Sır dosyası yolu (`PG_PASSWORD_FILE` vb.); içerik yalnız bağlantıda kullanılır. */
  readonly passwordFile: string;
  readonly max: number;
  /** `OTEL_SERVICE_NAME`; yoksa `eda-<rol>`. */
  readonly applicationName?: string;
}

const JSON_OID = 114;

/** Havuz başına tip ayrıştırıcıları: yalnız `json` ham dize (030 Tuzak 9). */
export const poolTypes: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === JSON_OID
      ? (value: string) => value
      : pg.types.getTypeParser(oid, format ?? 'text')) as pg.CustomTypesConfig['getTypeParser'],
};

export function createPool(role: PoolRole, cfg: PoolConfig): pg.Pool {
  const password = readFileSync(cfg.passwordFile, 'utf8').trim();
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password,
    max: cfg.max,
    application_name: cfg.applicationName ?? `eda-${role}`,
    idleTimeoutMillis: CONFIG_DEFAULTS['db.poolIdleTimeoutMs'],
    connectionTimeoutMillis: CONFIG_DEFAULTS['db.poolConnectTimeoutMs'],
    types: poolTypes,
  });
  // Boştaki istemcinin sunucu tarafından kapatılması süreci düşürmez; istemci havuzdan atılır.
  pool.on('error', () => undefined);
  return pool;
}
