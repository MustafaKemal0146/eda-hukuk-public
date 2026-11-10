// Yönetim yüzeyi (`:8010`) HTTP sözleşmeleri (053-ekranlar/11 §5; P27). Yanıtlar içeriksizdir: kullanıcı
// yazısı, dava/evrak bilgisi veya sorgu metni taşımaz; yalnız sayılar, kimlikler ve durumlar.
import { z } from 'zod';

const IsoDateTime = z.iso.datetime({ offset: true });

export const AdminMeDto = z.strictObject({
  userId: z.uuid(),
  name: z.string(),
  platformRole: z.enum(['super_admin', 'support']),
  environment: z.string(),
  maintenanceMode: z.boolean(),
  session: z.strictObject({
    expiresAt: IsoDateTime,
    stepUpValidUntil: IsoDateTime.nullable(),
    /** Oturumu açan güçlü doğrulama yöntemi; yeniden doğrulama (step-up) aynı yöntemi ister. */
    mfaLevel: z.enum(['passkey', 'totp']),
  }),
});
export type AdminMeDtoValue = z.infer<typeof AdminMeDto>;

// --- Pano (053-ekranlar/11 §3.1) ----------------------------------------------------------------

export const AdminOverviewDto = z.strictObject({
  verifiedUsers: z.number().int(),
  orgs: z.strictObject({
    individual: z.number().int(),
    firm: z.number().int(),
    suspended: z.number().int(),
  }),
  applications: z.strictObject({
    pending: z.number().int(),
    oldestPendingAt: IsoDateTime.nullable(),
  }),
  subscriptions: z.strictObject({
    trialing: z.number().int(),
    active: z.number().int(),
    pastDue: z.number().int(),
  }),
  signups7d: z.number().int(),
  today: z.strictObject({
    chatTurns: z.number().int(),
    activeUsers: z.number().int(),
    llmCalls: z.number().int(),
    llmCostMicroUsd: z.number().int(),
  }),
});
export type AdminOverviewDtoValue = z.infer<typeof AdminOverviewDto>;

// --- Başvurular (053-ekranlar/11 §3.2) ----------------------------------------------------------

export const APPLICATION_LIST_STATUSES = ['pending_verification', 'verified', 'rejected'] as const;

export const AdminApplicationDto = z.strictObject({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  baro: z.string(),
  sicilNo: z.string().nullable(),
  traineeRegistryNo: z.string().nullable(),
  status: z.enum(APPLICATION_LIST_STATUSES),
  source: z.string().nullable(),
  submittedAt: IsoDateTime,
  reviewedAt: IsoDateTime.nullable(),
  rejectionReason: z.string().nullable(),
});
export type AdminApplicationDtoValue = z.infer<typeof AdminApplicationDto>;

export const ListApplicationsQuery = z.strictObject({
  status: z.enum(APPLICATION_LIST_STATUSES).default('pending_verification'),
  cursor: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListApplicationsQueryValue = z.infer<typeof ListApplicationsQuery>;

export const AdminApplicationListResponse = z.strictObject({
  items: z.array(AdminApplicationDto),
  nextCursor: IsoDateTime.nullable(),
});
export type AdminApplicationListResponseValue = z.infer<typeof AdminApplicationListResponse>;

export const REJECT_REASON_CODES = [
  'not_found_in_registry',
  'identity_mismatch',
  'incomplete_information',
  'duplicate_registry',
  'not_eligible',
  'other',
] as const;

export const RejectApplicationInput = z.strictObject({ reasonCode: z.enum(REJECT_REASON_CODES) });
export type RejectApplicationInputValue = z.infer<typeof RejectApplicationInput>;

export const DecisionResult = z.strictObject({
  userId: z.uuid(),
  status: z.enum(['verified', 'rejected']),
});

// --- İstatistikler (içeriksiz, toplulaştırılmış; kullanıcı bazlı veri YOK) --------------------------

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const StatsQuery = z.strictObject({ from: IsoDate, to: IsoDate });
export type StatsQueryValue = z.infer<typeof StatsQuery>;

export const StatsDailyDto = z.strictObject({
  day: IsoDate,
  signups: z.number().int(),
  applications: z.number().int(),
  approvals: z.number().int(),
  rejections: z.number().int(),
  activeUsers: z.number().int(),
  conversations: z.number().int(),
  chatTurns: z.number().int(),
  documents: z.number().int(),
  calendarEvents: z.number().int(),
  llmCalls: z.number().int(),
  llmErrors: z.number().int(),
  llmCostMicroUsd: z.number().int(),
});

export const StatsFunnelDto = z.strictObject({
  signups: z.number().int(),
  emailVerified: z.number().int(),
  applications: z.number().int(),
  approved: z.number().int(),
  rejected: z.number().int(),
  pending: z.number().int(),
  medianDecisionHours: z.number().nullable(),
});

export const StatsBreakdownDto = z.strictObject({
  dimension: z.enum(['task', 'model_alias', 'document_kind', 'event_type']),
  key: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  costMicroUsd: z.number().int(),
});

export const AdminStatsResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  daily: z.array(StatsDailyDto),
  funnel: StatsFunnelDto,
  breakdown: z.array(StatsBreakdownDto),
});
export type AdminStatsResponseValue = z.infer<typeof AdminStatsResponse>;
