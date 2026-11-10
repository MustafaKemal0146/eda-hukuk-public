// Yönetim denetim günlüğü ve hata özeti sözleşmeleri (053-ekranlar/11 "Denetim" modülü). Olay türleri
// 002 §22 kataloğundan gelir (`AUDIT_ACTIONS`); yanıt içeriksizdir: olay meta verisi YALNIZ beyaz listeli
// anahtarlar ve güvenli skaler değerlerle döner (kimlik, kod, enum değeri, sayı).
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../audit-events.ts';
import { AUDIT_ACTOR_TYPES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Olay meta verisinde gösterilebilen anahtarlar (002 §22: yalnız kimlik, kod, eski/yeni enum değeri). */
export const AUDIT_METADATA_KEYS = [
  'reasonCode',
  'kind',
  'noteCode',
  'amount',
  'orgId',
  'role',
  'oldRole',
  'newRole',
  'oldValue',
  'newValue',
  'status',
  'count',
  'code',
  'scope',
] as const;
export type AuditMetadataKey = (typeof AUDIT_METADATA_KEYS)[number];

/** Güvenli metin değeri: kod/kimlik benzeri; boşluk, `@` ve serbest metin içeremez. */
export const AUDIT_SAFE_TEXT = /^[A-Za-z0-9_.:-]{1,64}$/;

export const AUDIT_ERROR_SOURCES = ['ai_usage', 'auth_failure', 'email_delivery'] as const;
export type AuditErrorSource = (typeof AUDIT_ERROR_SOURCES)[number];

export const AUDIT_PAGE_MAX = 100;
export const AUDIT_RANGE_MAX_DAYS = 92;

export const AuditEventsQuery = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  /** Opak imleç: `<created_at ISO>|<id>`. */
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\|[0-9a-f-]{36}$/i)
    .optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).optional(),
});
export type AuditEventsQueryValue = z.infer<typeof AuditEventsQuery>;

export const AuditEventDto = z.strictObject({
  id: z.uuid(),
  at: IsoDateTime,
  action: z.enum(AUDIT_ACTIONS),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  actorId: z.uuid().nullable(),
  orgId: z.uuid().nullable(),
  targetType: z.string().regex(AUDIT_SAFE_TEXT).nullable(),
  targetId: z.string().regex(AUDIT_SAFE_TEXT).nullable(),
  metadata: z.partialRecord(
    z.enum(AUDIT_METADATA_KEYS),
    z.union([z.string().regex(AUDIT_SAFE_TEXT), z.number(), z.boolean()]),
  ),
});
export type AuditEventDtoValue = z.infer<typeof AuditEventDto>;

export const AuditEventsResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  items: z.array(AuditEventDto),
  nextCursor: z.string().nullable(),
});
export type AuditEventsResponseValue = z.infer<typeof AuditEventsResponse>;

// --- Hata özeti: ai_usage hataları, giriş başarısızlıkları, başarısız e-posta teslimleri ---------------

export const AuditErrorsQuery = z.strictObject({ from: IsoDate, to: IsoDate });
export type AuditErrorsQueryValue = z.infer<typeof AuditErrorsQuery>;

export const AuditErrorsResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  /** Günlük sayılar (kaynak başına). */
  daily: z.array(
    z.strictObject({
      day: IsoDate,
      aiUsage: z.number().int(),
      authFailure: z.number().int(),
      emailDelivery: z.number().int(),
    }),
  ),
  /** En sık hata türleri (kaynak + tür anahtarı + sayı); en çok 20 satır. */
  top: z.array(
    z.strictObject({
      source: z.enum(AUDIT_ERROR_SOURCES),
      key: z.string().regex(AUDIT_SAFE_TEXT),
      count: z.number().int(),
    }),
  ),
  totals: z.strictObject({
    aiUsage: z.number().int(),
    authFailure: z.number().int(),
    emailDelivery: z.number().int(),
  }),
});
export type AuditErrorsResponseValue = z.infer<typeof AuditErrorsResponse>;

// --- Yönetim girişi sayaçları: başarısız deneme ve kilitlenme (IP, e-posta ve kimlik içermez) ---------

/**
 * `GET .../audit/login-failures`: `auth.login.failure` denetim olaylarından (yüzey `admin`) türetilen sayaçlar.
 * Olaylar IP başına dakikalık örneklendiğinden (`audit.loginFailureSamplePerIpPerMin`) sayılar alt sınırdır.
 * Kilitlenme = üstel geri çekilme nedeniyle reddedilen deneme (`backoff`).
 */
export const AuditLoginFailuresResponse = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  failures24h: z.number().int().nonnegative(),
  failures7d: z.number().int().nonnegative(),
  lockouts24h: z.number().int().nonnegative(),
  /** Son 24 saatin neden dağılımı (kod benzeri anahtar + sayı); en çok 10 satır. */
  byReason: z
    .array(z.strictObject({ key: z.string().regex(AUDIT_SAFE_TEXT), count: z.number().int() }))
    .max(10),
});
export type AuditLoginFailuresResponseValue = z.infer<typeof AuditLoginFailuresResponse>;
