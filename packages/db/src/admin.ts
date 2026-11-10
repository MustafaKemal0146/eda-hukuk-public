// `@eda/db/admin` (031 §8.2, §9, §10): `eda_readonly_admin` havuzu (PG_ADMIN_RO_*). Yalnız
// apps/api/src/admin/** içe aktarır (dependency-cruiser `db-admin-subpath`). Bu rol yalnız rollup
// tablolarını SELECT eder ve `app.admin_*` fonksiyonlarını çağırır; kiracı tablosu yetkisi yoktur
// (Q12). Ham `Pool` dışa verilmez: işlemler `withAdmin` ile salt-okur açılır.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { loadAdminPoolConfig } from './config/load.ts';
import { createPool } from './pool.ts';

export interface AdminTx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
  readonly db: NodePgDatabase;
}

export interface AdminDb {
  /** Salt-okur işlem (`BEGIN READ ONLY`); hata olursa geri alınır. */
  withAdmin<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T>;
  /**
   * Yazma işlemi: rol yalnız `app.admin_*` SECURITY DEFINER fonksiyonlarını çağırabildiği için
   * yazmalar bu fonksiyonlardan geçer (031 §8.2); `make approve-user` kararı bunu kullanır.
   */
  withAdminWrite<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** Verilen havuzla admin erişimi (test ve varsayılan kurulum). */
export function createAdminDb(pool: pg.Pool): AdminDb {
  async function run<T>(begin: string, fn: (tx: AdminTx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query(begin);
      const tx: AdminTx = {
        query: (text, values) => client.query(text, values as unknown[] | undefined),
        db: drizzle({ client }),
      };
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw err;
    } finally {
      client.release(discard ? true : undefined);
    }
  }
  return {
    withAdmin: (fn) => run('BEGIN READ ONLY', fn),
    withAdminWrite: (fn) => run('BEGIN', fn),
    end: () => pool.end(),
  };
}

let defaultDb: AdminDb | undefined;

/** Varsayılan admin erişimi; ilk çağrıda env'den kurulur. */
export function adminDb(): AdminDb {
  defaultDb ??= createAdminDb(createPool('admin', loadAdminPoolConfig()));
  return defaultDb;
}

/** Varsayılan `withAdmin` kısayolu. */
export function withAdmin<T>(fn: (tx: AdminTx) => Promise<T>): Promise<T> {
  return adminDb().withAdmin(fn);
}

export async function closeAdminDb(): Promise<void> {
  const d = defaultDb;
  defaultDb = undefined;
  await d?.end();
}
