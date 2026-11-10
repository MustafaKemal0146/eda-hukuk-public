// RLS matrisi yardımcıları (031 §12). `forgedAppClient`, uygulamanın ASLA yapmadığı bir şeyi taklit
// eder: kiracı bağını `withTenant` (üyelik denetimi) dışından, sahte oturum değişkenleriyle kuran ham
// eda_app bağlantısı ("ham sorgu yapılsa", RLS-03/06/07). Bağ SQL ile değil, bağlantı başlangıç
// seçeneğiyle kurulur; bu desen check-tenant-binding.sh'ta (forged-binding) yalnız bu dosyaya izinlidir.
import pg from 'pg';
import { RLS_MANIFEST, RLS_TABLES } from '../../src/rls/manifest.ts';
import { pgCode, pgTarget, rolePassword } from './db.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sahte bağlı ham eda_app istemcisi (bağlanmış). */
export async function forgedAppClient(orgId: string | null, userId: string): Promise<pg.Client> {
  for (const v of [orgId ?? userId, userId]) {
    if (!UUID_RE.test(v)) throw new Error('forgedAppClient: kimlik uuid olmalı');
  }
  const t = pgTarget();
  const opts = [`-c app.user_id=${userId}`, ...(orgId ? [`-c app.org_id=${orgId}`] : [])];
  const client = new pg.Client({
    host: t.host,
    port: t.port,
    database: t.database,
    user: 'eda_app',
    password: rolePassword('eda_app'),
    application_name: 'eda-db-test-forged',
    options: opts.join(' '),
    connectionTimeoutMillis: 5000,
  });
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

/** Sözün SQLSTATE'i (başarılıysa undefined). */
export const codeOf = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );

/** eda_app'in tablo veya kolon düzeyinde SELECT yetkisi olan RLS'li (E) tablolar. */
export function appSelectableTables(): string[] {
  return RLS_TABLES.filter((t) => {
    const g = RLS_MANIFEST[t]?.grants.eda_app;
    return (g?.table ?? []).includes('SELECT') || (g?.select ?? []).length > 0;
  });
}

/** eda_app'in hiç SELECT yetkisi olmayan RLS'li tablolar (erişim 42501). */
export function appUnselectableTables(): string[] {
  const ok = new Set(appSelectableTables());
  return RLS_TABLES.filter((t) => !ok.has(t));
}

/**
 * Her E tabloda görünen satır sayısı (tablo adı -> sayı). SELECT yetkisi olmayan tablo -1 ile
 * döner (çağıran 42501'i ayrıca doğrular). Kullanıcı kapsamlı (`class: 'user'`) tablolarda kişinin
 * kendi satırları büro bağından bağımsız görünür (ME; 031 §4.4); `selfUserId` verilirse bu
 * tablolarda yalnız BAŞKA kullanıcıların satırları sayılır.
 */
export async function visibleCounts(
  client: pg.Client,
  selfUserId?: string,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of appSelectableTables()) {
    const userScoped = RLS_MANIFEST[t]?.class === 'user' && selfUserId !== undefined;
    const r = userScoped
      ? await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM app.${t} WHERE user_id IS DISTINCT FROM $1`,
          [selfUserId],
        )
      : await client.query<{ n: string }>(`SELECT count(*) AS n FROM app.${t}`);
    out[t] = Number(r.rows[0]?.n);
  }
  for (const t of appUnselectableTables()) out[t] = -1;
  return out;
}
