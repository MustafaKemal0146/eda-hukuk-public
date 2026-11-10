// Ön koşul denetimi (032 §6.2; çıkış 10). Roller, eklentiler, FTS sözlükleri, harmanlama ve uuidv7()
// süper kullanıcı ister ve initdb'de kurulur; migrate bunları OLUŞTURMAZ, yalnız varlığını doğrular.
// Mevcut kümeye sonradan eklenenler infra/postgres/upgrade/ + 073 runbook'u ile uygulanır.
// Denetim iki adımdır: canlı kümeden olgular toplanır, saf `evaluatePreflight` karar verir (testte
// olgular değiştirilerek her eksiklik ayrı sınanır).
import type { ClientBase } from 'pg';
import { EXIT, MigrateError } from './exit-codes.ts';
import type { MigrateLogger } from './log.ts';
import { parseSetConfig, ROLE_SPECS, roleSettingDiffs } from './roles.ts';

export const REQUIRED_EXTENSIONS = [
  'vector',
  'pg_textsearch',
  'pg_trgm',
  'unaccent',
  'pgcrypto',
  'pg_stat_statements',
  'btree_gist',
] as const;
export const REQUIRED_PRELOAD = ['pg_textsearch', 'pg_stat_statements'] as const;
export const REQUIRED_DICTS = ['tr_hukuk_protected', 'tr_hukuk_stem'] as const;
/** 023 §3.6 duman testi: `kanunun maddesi` -> `kanun`, `madde`. */
export const TS_SMOKE = { input: 'kanunun maddesi', lexemes: ['kanun', 'madde'] } as const;
export const MIN_SERVER_VERSION_NUM = 180000;
/** 031 §10 / 002 §26 madde 31.2: bağlantı bütçesi üst sınırı (uyarı). */
export const MAX_CONNECTIONS_WARN = 100;

export interface RoleFact {
  readonly name: string;
  readonly login: boolean;
  readonly bypassRls: boolean;
  readonly superuser: boolean;
}

export interface PreflightFacts {
  readonly serverVersionNum: number;
  readonly dataChecksums: boolean;
  readonly roles: readonly RoleFact[];
  readonly roleSettings: ReadonlyMap<string, Record<string, string>>;
  readonly extensions: readonly string[];
  readonly sharedPreloadLibraries: readonly string[];
  readonly ftsConfig: boolean;
  readonly dictionaries: readonly string[];
  readonly tsSmokeLexemes: readonly string[];
  readonly trCollation: boolean;
  readonly uuidv7: boolean;
  readonly maxConnections: number;
}

export async function gatherPreflightFacts(client: ClientBase): Promise<PreflightFacts> {
  const one = async <T>(sql: string): Promise<T> => {
    const res = await client.query(sql);
    return res.rows[0] as T;
  };
  const base = await one<{
    v: string;
    checksums: string;
    preload: string;
    maxconn: string;
    fts: boolean;
    coll: boolean;
    uuid7: boolean;
  }>(`
    SELECT current_setting('server_version_num') AS v,
           current_setting('data_checksums') AS checksums,
           current_setting('shared_preload_libraries') AS preload,
           current_setting('max_connections') AS maxconn,
           EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config c
                   JOIN pg_catalog.pg_namespace n ON n.oid = c.cfgnamespace
                   WHERE n.nspname = 'public' AND c.cfgname = 'tr_hukuk') AS fts,
           EXISTS (SELECT 1 FROM pg_catalog.pg_collation WHERE collname = 'tr-TR-x-icu') AS coll,
           to_regprocedure('uuidv7()') IS NOT NULL AS uuid7`);
  const roles = await client.query<{
    rolname: string;
    rolcanlogin: boolean;
    rolbypassrls: boolean;
    rolsuper: boolean;
  }>(
    `SELECT rolname, rolcanlogin, rolbypassrls, rolsuper FROM pg_catalog.pg_roles
     WHERE rolname LIKE 'eda\\_%' OR rolsuper OR rolbypassrls`,
  );
  const settings = await client.query<{ rolname: string; setconfig: string[] | null }>(
    `SELECT r.rolname, s.setconfig
     FROM pg_catalog.pg_db_role_setting s
     JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
     JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
     WHERE d.datname = current_database()`,
  );
  const ext = await client.query<{ extname: string }>(
    'SELECT extname FROM pg_catalog.pg_extension',
  );
  const dicts = await client.query<{ dictname: string }>(
    `SELECT d.dictname FROM pg_catalog.pg_ts_dict d
     JOIN pg_catalog.pg_namespace n ON n.oid = d.dictnamespace WHERE n.nspname = 'public'`,
  );
  let lexemes: string[] = [];
  if (base.fts) {
    const smoke = await client.query<{ lexeme: string }>(
      `SELECT lexeme FROM unnest(to_tsvector('public.tr_hukuk'::regconfig, $1)) ORDER BY positions[1]`,
      [TS_SMOKE.input],
    );
    lexemes = smoke.rows.map((r) => r.lexeme);
  }
  const roleSettings = new Map<string, Record<string, string>>();
  for (const r of settings.rows) roleSettings.set(r.rolname, parseSetConfig(r.setconfig));
  return {
    serverVersionNum: Number(base.v),
    dataChecksums: base.checksums === 'on',
    roles: roles.rows.map((r) => ({
      name: r.rolname,
      login: r.rolcanlogin,
      bypassRls: r.rolbypassrls,
      superuser: r.rolsuper,
    })),
    roleSettings,
    extensions: ext.rows.map((r) => r.extname),
    sharedPreloadLibraries: base.preload
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    ftsConfig: base.fts,
    dictionaries: dicts.rows.map((r) => r.dictname),
    tsSmokeLexemes: lexemes,
    trCollation: base.coll,
    uuidv7: base.uuid7,
    maxConnections: Number(base.maxconn),
  };
}

export interface PreflightResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Olgulardan karar: `errors` boş değilse migrate çıkış 10 ile durur. */
export function evaluatePreflight(f: PreflightFacts): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (f.serverVersionNum < MIN_SERVER_VERSION_NUM) errors.push('PostgreSQL 18 veya üstü gerekli');
  if (!f.dataChecksums) errors.push('data_checksums kapalı');

  const byName = new Map(f.roles.map((r) => [r.name, r]));
  for (const spec of ROLE_SPECS) {
    const r = byName.get(spec.name);
    if (r === undefined) {
      errors.push(`rol eksik: ${spec.name}`);
      continue;
    }
    if (r.login !== spec.login || r.bypassRls !== spec.bypassRls || r.superuser) {
      errors.push(`rol nitelikleri beklenenden farklı: ${spec.name}`);
    }
  }
  const allowedBypass = new Set([
    'postgres',
    ...ROLE_SPECS.filter((s) => s.bypassRls).map((s) => s.name),
  ]);
  for (const r of f.roles) {
    if (r.superuser && r.name !== 'postgres') errors.push(`beklenmeyen süper kullanıcı: ${r.name}`);
    if (r.bypassRls && !allowedBypass.has(r.name)) errors.push(`beklenmeyen BYPASSRLS: ${r.name}`);
  }
  for (const d of roleSettingDiffs(f.roleSettings)) errors.push(`rol ayarı: ${d}`);

  const ext = new Set(f.extensions);
  for (const e of REQUIRED_EXTENSIONS) if (!ext.has(e)) errors.push(`eklenti eksik: ${e}`);
  const preload = new Set(f.sharedPreloadLibraries);
  for (const p of REQUIRED_PRELOAD) {
    if (!preload.has(p)) errors.push(`shared_preload_libraries içinde yok: ${p}`);
  }
  if (!f.ftsConfig) errors.push('FTS yapılandırması eksik: public.tr_hukuk');
  const dicts = new Set(f.dictionaries);
  for (const d of REQUIRED_DICTS) if (!dicts.has(d)) errors.push(`FTS sözlüğü eksik: public.${d}`);
  if (f.ftsConfig && f.tsSmokeLexemes.join(' ') !== TS_SMOKE.lexemes.join(' ')) {
    errors.push('tr_hukuk duman testi başarısız (kanunun maddesi -> kanun, madde)');
  }
  if (!f.trCollation) errors.push('harmanlama eksik: tr-TR-x-icu');
  if (!f.uuidv7) errors.push('uuidv7() bulunamadı');
  if (f.maxConnections > MAX_CONNECTIONS_WARN) {
    warnings.push(`max_connections ${f.maxConnections} > ${MAX_CONNECTIONS_WARN}`);
  }
  return { errors, warnings };
}

/** Uzun işlem taşıyan başka oturum sayısı (032 §6.2 madde 8). */
export async function countLongTransactions(
  client: ClientBase,
  longTxSec: number,
): Promise<number> {
  const res = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_catalog.pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND xact_start < now() - ($1::int * interval '1 second')`,
    [longTxSec],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export interface PreflightOptions {
  readonly log: MigrateLogger;
  readonly longTxSec: number;
  readonly waitBudgetMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly gather?: (client: ClientBase) => Promise<PreflightFacts>;
}

/** Ön koşulları denetler; eksiklikte `MigrateError(10)`. Uzun işlem yalnız uyarı + bekleme. */
export async function runPreflight(client: ClientBase, opts: PreflightOptions): Promise<void> {
  const facts = await (opts.gather ?? gatherPreflightFacts)(client);
  const result = evaluatePreflight(facts);
  for (const w of result.warnings)
    opts.log.write({ level: 'warn', event: 'preflight.warning', reason: w });
  if (result.errors.length > 0) {
    for (const e of result.errors)
      opts.log.write({ level: 'error', event: 'preflight.failed', reason: e });
    throw new MigrateError(
      EXIT.preflight,
      `ön koşul denetimi başarısız (${result.errors.length} eksik)`,
    );
  }
  const deadline = Date.now() + opts.waitBudgetMs;
  let long = await countLongTransactions(client, opts.longTxSec);
  if (long > 0) opts.log.write({ level: 'warn', event: 'preflight.long_transaction', count: long });
  while (long > 0 && Date.now() < deadline) {
    await opts.sleep(opts.pollMs);
    long = await countLongTransactions(client, opts.longTxSec);
  }
  opts.log.write({ level: 'info', event: 'preflight.ok' });
}
