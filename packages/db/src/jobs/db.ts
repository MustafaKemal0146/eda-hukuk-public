// `eda_jobs` erişimi (031 §10, §11): BYPASSRLS rol; her sorgu açık `org_id`/kimlik filtresi taşır ve
// yalnız manifestteki `jobsColumns` kolonlarını okur (Q10). Ham `Pool` dışa verilmez.
import type pg from 'pg';

export interface JobsQueryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export interface JobsDb extends JobsQueryable {
  /** Tek bağlantıda işlem; hata olursa geri alınır. */
  transaction<T>(fn: (tx: JobsQueryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** Verilen havuzu `JobsDb` ile sarar (havuz dışarı sızmaz). */
export function wrapJobsPool(pool: pg.Pool): JobsDb {
  return {
    query: (text, values) => pool.query(text, values as unknown[] | undefined),
    async transaction(fn) {
      const client = await pool.connect();
      let discard = false;
      try {
        await client.query('BEGIN');
        const out = await fn({
          query: (text, values) => client.query(text, values as unknown[] | undefined),
        });
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
    },
    end: () => pool.end(),
  };
}
