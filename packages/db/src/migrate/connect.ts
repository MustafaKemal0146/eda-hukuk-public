// migrate ve seed girişlerinin eda_owner bağlantısı (032 §6): Postgres hazır olana dek yeniden dener;
// toplam bütçe db.migrationAdvisoryWaitSec, aralık db.migrationLockRetryWaitMs (ayrı anahtar yok;
// ). Parola yalnız sır dosyasından okunur ve hiçbir yere yazılmaz.
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EnvOf } from '@eda/contracts/config/env';
import pg from 'pg';
import { EXIT } from './exit-codes.ts';
import type { MigrateLogger } from './log.ts';

async function connectWithRetry(config: pg.ClientConfig, log: MigrateLogger): Promise<pg.Client> {
  const deadline = Date.now() + CONFIG_DEFAULTS['db.migrationAdvisoryWaitSec'] * 1000;
  for (let attempt = 1; ; attempt++) {
    const client = new pg.Client(config);
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => undefined);
      const sqlstate = (err as { code?: unknown }).code;
      log.write({
        level: 'warn',
        event: 'connect.retry',
        attempt,
        ...(typeof sqlstate === 'string' ? { reason: sqlstate } : {}),
      });
      if (Date.now() >= deadline) throw err;
      await new Promise((r) => setTimeout(r, CONFIG_DEFAULTS['db.migrationLockRetryWaitMs']));
    }
  }
}

/** eda_owner istemcisi; bağlanamazsa `connect.failed` (çıkış 10) günlüğü yazar ve undefined döner. */
export async function connectOwner(
  env: EnvOf<'migrate'>,
  log: MigrateLogger,
): Promise<pg.Client | undefined> {
  const password = readFileSync(env.PG_PASSWORD_FILE, 'utf8').trim();
  try {
    return await connectWithRetry(
      {
        host: env.PG_HOST,
        port: env.PG_PORT,
        database: env.PG_DATABASE,
        user: env.PG_USER,
        password,
        application_name: env.OTEL_SERVICE_NAME ?? 'eda-migrate',
        connectionTimeoutMillis: CONFIG_DEFAULTS['db.poolConnectTimeoutMs'],
      },
      log,
    );
  } catch {
    log.write({ level: 'error', event: 'connect.failed', code: EXIT.preflight });
    return undefined;
  }
}
