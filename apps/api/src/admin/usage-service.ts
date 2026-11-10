// Yönetim "Kullanım ve limitler" servisi: kullanım okuması ve büro limit geçersiz kılma. Tüm erişim
// `eda_readonly_admin` havuzundan `app.admin_*` SECURITY DEFINER fonksiyonlarıyla yapılır; aktör her
// çağrıda veritabanında `super_admin` olarak doğrulanır. Çıktı içeriksizdir (yalnız sayaç ve limit).
import {
  type AdminLimitsResponseValue,
  type AdminUsageResponseValue,
  ORG_LIMIT_KEYS,
  type OrgLimitKey,
  type OrgLimitResultValue,
} from '@eda/contracts/api/admin-usage';
import {
  CONFIG_ADMIN_EDITABLE,
  CONFIG_DEFAULTS,
  type ConfigKey,
  type ConfigValue,
} from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface AdminUsageServiceDeps {
  readonly db: AdminDb;
}

/** Limit ekranında gösterilen ayar grupları (anahtar öneki). */
export const LIMIT_GROUPS = [
  'chat',
  'costGuard',
  'credits',
  'rateLimit',
  'upload',
  'files',
  'kvkk',
  'trial',
] as const;

/** Önek dışında gösterilen sınır anahtarları (kaynak canlı sorgu sınırları). */
const EXTRA_LIMIT_KEYS: readonly ConfigKey[] = [
  'sources.orgLivePerMin',
  'sources.userLivePerMin',
  'sources.turnMaxLiveFetches',
  'sources.turnMaxLiveSearches',
];

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const dayOf = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

type PlainValue = number | string | boolean | null | (number | string)[];

const isPlainValue = (v: unknown): v is PlainValue =>
  v === null ||
  typeof v === 'number' ||
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (Array.isArray(v) && v.every((x) => typeof x === 'number' || typeof x === 'string'));

/** Limit ekranına giren ayar anahtarları (sıralı). */
export function limitKeys(): ConfigKey[] {
  const all = Object.keys(CONFIG_DEFAULTS) as ConfigKey[];
  const picked = all.filter(
    (k) =>
      (LIMIT_GROUPS as readonly string[]).includes(k.split('.')[0] ?? '') ||
      EXTRA_LIMIT_KEYS.includes(k),
  );
  return picked.sort();
}

const isOrgLimitKey = (k: string): k is OrgLimitKey =>
  (ORG_LIMIT_KEYS as readonly string[]).includes(k);

type Counters = {
  calls: number;
  errors: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costMicroUsd: number;
};
const zero = (): Counters => ({
  calls: 0,
  errors: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costMicroUsd: 0,
});
const add = (a: Counters, b: Counters): Counters => ({
  calls: a.calls + b.calls,
  errors: a.errors + b.errors,
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  costMicroUsd: a.costMicroUsd + b.costMicroUsd,
});

export function createAdminUsageService(deps: AdminUsageServiceDeps) {
  return {
    async usage(
      actorId: string,
      from: string,
      to: string,
      orgId: string | null,
    ): Promise<AdminUsageResponseValue> {
      let rows: {
        daily: Record<string, unknown>[];
        models: Record<string, unknown>[];
        orgs: Record<string, unknown>[];
      };
      try {
        rows = await deps.db.withAdmin(async (tx) => {
          const daily = await tx.query('SELECT * FROM app.admin_usage_daily($1, $2, $3, $4)', [
            actorId,
            from,
            to,
            orgId,
          ]);
          const models = await tx.query('SELECT * FROM app.admin_usage_models($1, $2, $3, $4)', [
            actorId,
            from,
            to,
            orgId,
          ]);
          const orgs =
            orgId === null
              ? await tx.query('SELECT * FROM app.admin_usage_top_orgs($1, $2, $3, $4)', [
                  actorId,
                  from,
                  to,
                  10,
                ])
              : { rows: [] };
          return {
            daily: daily.rows as Record<string, unknown>[],
            models: models.rows as Record<string, unknown>[],
            orgs: orgs.rows as Record<string, unknown>[],
          };
        });
      } catch (err) {
        if (sqlState(err) === '22023')
          throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
        if (sqlState(err) === '42501')
          throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
      const daily = rows.daily.map((x) => ({
        day: dayOf(x.day),
        calls: n(x.calls),
        errors: n(x.errors),
        inputTokens: n(x.input_tokens),
        cachedInputTokens: n(x.cached_input_tokens),
        outputTokens: n(x.output_tokens),
        reasoningTokens: n(x.reasoning_tokens),
        costMicroUsd: n(x.cost_micro_usd),
        activeOrgs: n(x.active_orgs),
      }));
      const months = new Map<string, Counters>();
      let totals = zero();
      for (const d of daily) {
        const c: Counters = {
          calls: d.calls,
          errors: d.errors,
          inputTokens: d.inputTokens,
          cachedInputTokens: d.cachedInputTokens,
          outputTokens: d.outputTokens,
          reasoningTokens: d.reasoningTokens,
          costMicroUsd: d.costMicroUsd,
        };
        totals = add(totals, c);
        const m = d.day.slice(0, 7);
        months.set(m, add(months.get(m) ?? zero(), c));
      }
      return {
        from,
        to,
        orgId,
        totals,
        daily,
        monthly: [...months.entries()].map(([month, c]) => ({ month, ...c })),
        models: rows.models.map((x) => ({
          modelAlias: String(x.model_alias),
          calls: n(x.calls),
          errors: n(x.errors),
          inputTokens: n(x.input_tokens),
          outputTokens: n(x.output_tokens),
          costMicroUsd: n(x.cost_micro_usd),
        })),
        topOrgs: rows.orgs.map((x) => ({
          orgId: String(x.org_id),
          orgLabel: String(x.org_label),
          orgKind: String(x.org_kind),
          calls: n(x.calls),
          inputTokens: n(x.input_tokens),
          outputTokens: n(x.output_tokens),
          costMicroUsd: n(x.cost_micro_usd),
        })),
      };
    },

    async limits(actorId: string, orgId: string | null): Promise<AdminLimitsResponseValue> {
      const keys = limitKeys();
      let settings: Record<string, unknown>[];
      let overrides: Record<string, unknown>[];
      try {
        const r = await deps.db.withAdmin(async (tx) => ({
          settings: (
            await tx.query('SELECT * FROM app.admin_limit_platform_values($1, $2)', [actorId, keys])
          ).rows as Record<string, unknown>[],
          overrides: (
            await tx.query('SELECT * FROM app.admin_org_limits_list($1, $2)', [actorId, orgId])
          ).rows as Record<string, unknown>[],
        }));
        settings = r.settings;
        overrides = r.overrides;
      } catch (err) {
        if (sqlState(err) === '42501')
          throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
      const stored = new Map(settings.map((s) => [String(s.key), s.value] as const));
      return {
        items: keys.map((key) => {
          const raw = CONFIG_DEFAULTS[key] as ConfigValue;
          const def: PlainValue = typeof raw === 'object' && raw !== null ? Array.from(raw) : raw;
          const dbValue = stored.get(key);
          const fromDb = dbValue !== undefined && isPlainValue(dbValue);
          return {
            key,
            group: key.split('.')[0] ?? key,
            defaultValue: def,
            effectiveValue: fromDb ? dbValue : def,
            source: fromDb ? ('system_setting' as const) : ('default' as const),
            adminEditable: CONFIG_ADMIN_EDITABLE.has(key),
            orgOverridable: isOrgLimitKey(key),
          };
        }),
        overridableKeys: [...ORG_LIMIT_KEYS],
        overrides: overrides
          .filter((o) => isOrgLimitKey(String(o.key)))
          .map((o) => ({
            orgId: String(o.org_id),
            orgLabel: String(o.org_label),
            orgKind: String(o.org_kind),
            key: String(o.key) as OrgLimitKey,
            value: n(o.value),
            updatedAt: iso(o.updated_at),
          })),
      };
    },

    /** Büro limitini yazar; denetim satırı aynı işlemde fonksiyonda yazılır. */
    async setOrgLimit(
      actorId: string,
      orgId: string,
      key: OrgLimitKey,
      value: number,
    ): Promise<OrgLimitResultValue> {
      try {
        const prev = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ prev: string | null }>(
            'SELECT app.admin_org_limit_set($1, $2, $3, $4) AS prev',
            [actorId, orgId, key, value],
          );
          return r.rows[0]?.prev ?? null;
        });
        return { orgId, key, value, previousValue: prev === null ? null : Number(prev) };
      } catch (err) {
        const code = sqlState(err);
        if (code === 'P0002') throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
        if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        if (code === '22023')
          throw new AppError('VALIDATION_FAILED', { reason: 'amount_out_of_range' });
        throw err;
      }
    },

    /** Geçersiz kılmayı kaldırır; yoksa 404 (varlık/yokluk ayrışmaz). */
    async clearOrgLimit(
      actorId: string,
      orgId: string,
      key: OrgLimitKey,
    ): Promise<OrgLimitResultValue> {
      try {
        const prev = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ prev: string | null }>(
            'SELECT app.admin_org_limit_clear($1, $2, $3) AS prev',
            [actorId, orgId, key],
          );
          return r.rows[0]?.prev ?? null;
        });
        if (prev === null) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
        return { orgId, key, value: null, previousValue: Number(prev) };
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (sqlState(err) === '42501')
          throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
    },
  };
}

export type AdminUsageService = ReturnType<typeof createAdminUsageService>;
