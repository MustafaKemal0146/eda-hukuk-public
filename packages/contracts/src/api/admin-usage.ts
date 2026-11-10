// Yönetim paneli "Kullanım ve limitler" sözleşmeleri (053-ekranlar/11 §3.7). Yanıtlar içeriksiz ve
// toplulaştırılmıştır: kullanıcı, sohbet, belge veya sorgu bilgisi taşımaz; büro bazlı sayaçlar ve
// limit değerleri vardır. Para birimi micro-USD (1 USD = 1_000_000) tamsayıdır.
import { z } from 'zod';

/** Büro bazında geçersiz kılınabilen limit anahtarları (`app.org_limit_overrides.key`; 002 §7 büro kapsamlı anahtarlar). */
export const ORG_LIMIT_KEYS = [
  'costGuard.orgDailyCapFloorMicroUsd',
  'costGuard.orgDailyCapPerSeatMicroUsd',
  'files.orgMaxConcurrentJobs',
  'kvkk.searchPerOrgPerHour',
  'sources.orgLivePerMin',
] as const;
export type OrgLimitKey = (typeof ORG_LIMIT_KEYS)[number];

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.iso.datetime({ offset: true });
const Count = z.number().int().nonnegative();

/** Kullanım aralığı en çok 92 gün farkıdır (93 gün dahil; `app.admin_usage_*` ile aynı). */
export const USAGE_MAX_RANGE_DAYS = 92;

export const UsageQuery = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  orgId: z.uuid().optional(),
});
export type UsageQueryValue = z.infer<typeof UsageQuery>;

const UsageCounters = {
  calls: Count,
  errors: Count,
  inputTokens: Count,
  cachedInputTokens: Count,
  outputTokens: Count,
  reasoningTokens: Count,
  costMicroUsd: Count,
};

export const UsageDailyDto = z.strictObject({
  day: IsoDate,
  ...UsageCounters,
  activeOrgs: Count,
});

export const UsageMonthlyDto = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  ...UsageCounters,
});

export const UsageModelDto = z.strictObject({
  modelAlias: z.string(),
  calls: Count,
  errors: Count,
  inputTokens: Count,
  outputTokens: Count,
  costMicroUsd: Count,
});

export const UsageOrgDto = z.strictObject({
  orgId: z.uuid(),
  /** Büro görünen adı (kişi adı değil; bireysel büroda büro kaydı adıdır). */
  orgLabel: z.string(),
  orgKind: z.string(),
  calls: Count,
  inputTokens: Count,
  outputTokens: Count,
  costMicroUsd: Count,
});

export const AdminUsageResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  orgId: z.uuid().nullable(),
  totals: z.strictObject(UsageCounters),
  daily: z.array(UsageDailyDto),
  monthly: z.array(UsageMonthlyDto),
  models: z.array(UsageModelDto),
  /** Platform görünümünde en çok kullanan 10 büro; tek büro süzgecinde boştur. */
  topOrgs: z.array(UsageOrgDto).max(10),
});
export type AdminUsageResponseValue = z.infer<typeof AdminUsageResponse>;

// --- Limitler -----------------------------------------------------------------------------------

export const LimitValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.number(), z.string()])),
]);

export const LimitItemDto = z.strictObject({
  key: z.string(),
  group: z.string(),
  /** Koddaki varsayılan (`config/defaults`). */
  defaultValue: LimitValue,
  /** Etkin platform değeri: ayar tablosunda satır varsa o, yoksa varsayılan. */
  effectiveValue: LimitValue,
  source: z.enum(['default', 'system_setting']),
  /** Platform ayarı olarak yönetimden düzenlenebilir mi (002 §7 "Admin = E"). */
  adminEditable: z.boolean(),
  /** Büro bazında geçersiz kılınabilir mi. */
  orgOverridable: z.boolean(),
});

export const OrgLimitOverrideDto = z.strictObject({
  orgId: z.uuid(),
  orgLabel: z.string(),
  orgKind: z.string(),
  key: z.enum(ORG_LIMIT_KEYS),
  value: Count,
  updatedAt: IsoDateTime,
});

export const LimitsQuery = z.strictObject({ orgId: z.uuid().optional() });

export const AdminLimitsResponse = z.strictObject({
  items: z.array(LimitItemDto),
  overridableKeys: z.array(z.enum(ORG_LIMIT_KEYS)),
  overrides: z.array(OrgLimitOverrideDto),
});
export type AdminLimitsResponseValue = z.infer<typeof AdminLimitsResponse>;

/** Büro limit değeri pozitif tamsayıdır (güvenli tamsayı sınırına kadar). */
export const SetOrgLimitInput = z.strictObject({
  value: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type SetOrgLimitInputValue = z.infer<typeof SetOrgLimitInput>;

export const OrgLimitParams = z.strictObject({
  orgId: z.uuid(),
  key: z.enum(ORG_LIMIT_KEYS),
});

export const OrgLimitResult = z.strictObject({
  orgId: z.uuid(),
  key: z.enum(ORG_LIMIT_KEYS),
  value: Count.nullable(),
  previousValue: Count.nullable(),
});
export type OrgLimitResultValue = z.infer<typeof OrgLimitResult>;
