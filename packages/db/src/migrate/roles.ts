// Beklenen DB rolleri ve rol düzeyi ayarları (031 §2.1, §2.5; 002 §9). initdb 010-roles.sql ve
// 020-role-settings.sql bunları kurar; preflight ve testler canlı kümeyi bu tabloyla karşılaştırır
// (KK-031-1, KK-031-7). Zaman aşımları @eda/contracts db.* anahtarlarından türetilir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';

export interface RoleSpec {
  readonly name: string;
  readonly login: boolean;
  readonly bypassRls: boolean;
  /** `IN DATABASE eda` ayarları; `undefined` = ayar beklenmez (eda_backup: 073 belirler). */
  readonly settings?: Readonly<Record<string, string>>;
}

/** Milisaniyeyi PostgreSQL ayar metnine çevirir: 15000 -> `15s`, 0 -> `0`. */
export function pgDuration(ms: number): string {
  if (ms === 0) return '0';
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

const statement = pgDuration(CONFIG_DEFAULTS['db.statementTimeoutMs']);
const idle = pgDuration(CONFIG_DEFAULTS['db.idleInTxTimeoutMs']);
const lock = pgDuration(CONFIG_DEFAULTS['db.lockTimeoutMs']);
const jobsStatement = pgDuration(CONFIG_DEFAULTS['db.jobsStatementTimeoutMs']);

const runtime = (searchPath: string) => ({
  statement_timeout: statement,
  idle_in_transaction_session_timeout: idle,
  lock_timeout: lock,
  search_path: searchPath,
});

// 031 §2.5'te config anahtarı olmayan iki başlangıç değeri: eda_owner boşta işlem 60 sn
// (migrasyon dosya başı SET LOCAL kullanır), eda_monitor deyim 5 sn.
const OWNER_IDLE_IN_TX = '60s';
const MONITOR_STATEMENT = '5s';

export const ROLE_SPECS: readonly RoleSpec[] = [
  {
    name: 'eda_owner',
    login: true,
    bypassRls: false,
    settings: {
      statement_timeout: '0',
      idle_in_transaction_session_timeout: OWNER_IDLE_IN_TX,
      search_path: 'public',
    },
  },
  { name: 'eda_auth', login: true, bypassRls: false, settings: runtime('auth, public') },
  { name: 'eda_app', login: true, bypassRls: false, settings: runtime('app, public') },
  { name: 'eda_worker', login: true, bypassRls: false, settings: runtime('app, public') },
  {
    name: 'eda_jobs',
    login: true,
    bypassRls: true,
    settings: { ...runtime('app, public'), statement_timeout: jobsStatement },
  },
  { name: 'eda_readonly_admin', login: true, bypassRls: false, settings: runtime('app, public') },
  { name: 'eda_backup', login: true, bypassRls: false },
  {
    name: 'eda_monitor',
    login: true,
    bypassRls: false,
    settings: { ...runtime('public'), statement_timeout: MONITOR_STATEMENT },
  },
  { name: 'eda_rls_helper', login: false, bypassRls: true },
  { name: 'eda_sec_definer', login: false, bypassRls: true },
];

/** `pg_db_role_setting.setconfig` dizisini ad -> değer eşlemesine çevirir. */
export function parseSetConfig(setconfig: readonly string[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of setconfig ?? []) {
    const i = item.indexOf('=');
    if (i > 0) out[item.slice(0, i)] = item.slice(i + 1);
  }
  return out;
}

/** Rol ayarı uyuşmazlıklarını döndürür (boş dizi = eşit). */
export function roleSettingDiffs(
  actual: ReadonlyMap<string, Record<string, string>>,
  specs: readonly RoleSpec[] = ROLE_SPECS,
): string[] {
  const diffs: string[] = [];
  for (const spec of specs) {
    if (spec.settings === undefined) continue;
    const got = actual.get(spec.name) ?? {};
    for (const [key, want] of Object.entries(spec.settings)) {
      if (got[key] !== want)
        diffs.push(`${spec.name}.${key}: beklenen ${want}, bulunan ${got[key] ?? 'yok'}`);
    }
  }
  return diffs;
}
