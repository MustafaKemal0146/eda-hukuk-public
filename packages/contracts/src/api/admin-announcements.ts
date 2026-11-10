// Yönetim yüzeyi duyuru ve bildirim özeti sözleşmeleri (053-ekranlar/11 "Duyurular"; 041 §9.11).
// Duyuru metni platform yazısıdır (kullanıcı içeriği değil) ve düz metindir: HTML etiketi ve denetim
// karakteri reddedilir. Bildirim özeti yalnız tür başına toplulaştırılmış sayıdır; kişi bazlı satır yok.
import { z } from 'zod';
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_SEVERITIES, NOTIFICATION_TYPES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 1000;
export const ANNOUNCEMENT_STATES = ['scheduled', 'active', 'ended'] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

/** HTML etiketi (`<a`, `</`, `<!`) ve denetim karakterleri (satır sonu hariç) yasak. */
const HTML_TAG = /<\s*[a-zA-Z/!?]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: denetim karakterlerini reddetmek amaçtır
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !HTML_TAG.test(v), 'HTML etiketi kullanılamaz')
    .refine((v) => !CONTROL_CHARS.test(v), 'Denetim karakteri kullanılamaz');

const fields = {
  severity: z.enum(ANNOUNCEMENT_SEVERITIES),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  title: plainText(ANNOUNCEMENT_TITLE_MAX),
  body: plainText(ANNOUNCEMENT_BODY_MAX),
  activeFrom: IsoDateTime,
  activeUntil: IsoDateTime.nullable(),
};

const untilAfterFrom = (v: {
  activeFrom?: string | undefined;
  activeUntil?: string | null | undefined;
}) =>
  v.activeFrom === undefined ||
  v.activeUntil === undefined ||
  v.activeUntil === null ||
  Date.parse(v.activeUntil) > Date.parse(v.activeFrom);

export const AdminAnnouncementDto = z.strictObject({
  id: z.uuid(),
  severity: fields.severity,
  audience: fields.audience,
  title: z.string(),
  body: z.string(),
  activeFrom: IsoDateTime,
  activeUntil: IsoDateTime.nullable(),
  state: z.enum(ANNOUNCEMENT_STATES),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AdminAnnouncementDtoValue = z.infer<typeof AdminAnnouncementDto>;

export const ListAnnouncementsQuery = z.strictObject({
  cursor: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ListAnnouncementsQueryValue = z.infer<typeof ListAnnouncementsQuery>;

export const AdminAnnouncementListResponse = z.strictObject({
  items: z.array(AdminAnnouncementDto),
  nextCursor: IsoDateTime.nullable(),
});
export type AdminAnnouncementListResponseValue = z.infer<typeof AdminAnnouncementListResponse>;

/** Yayımlama: `activeFrom` verilmezse şimdi başlar; `activeUntil` boşsa süresizdir (geri çekilene dek). */
export const CreateAnnouncementInput = z
  .strictObject({
    severity: fields.severity,
    audience: fields.audience.default('all'),
    title: fields.title,
    body: fields.body,
    activeFrom: fields.activeFrom.optional(),
    activeUntil: fields.activeUntil.optional(),
  })
  .refine(untilAfterFrom, { path: ['activeUntil'], message: 'Bitiş, başlangıçtan sonra olmalı' });
export type CreateAnnouncementInputValue = z.infer<typeof CreateAnnouncementInput>;

/** Kısmi güncelleme; `activeUntil: null` süresiz yapar, alan yoksa değişmez. */
export const UpdateAnnouncementInput = z
  .strictObject({
    severity: fields.severity.optional(),
    audience: fields.audience.optional(),
    title: fields.title.optional(),
    body: fields.body.optional(),
    activeFrom: fields.activeFrom.optional(),
    activeUntil: fields.activeUntil.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekli' })
  .refine(untilAfterFrom, { path: ['activeUntil'], message: 'Bitiş, başlangıçtan sonra olmalı' });
export type UpdateAnnouncementInputValue = z.infer<typeof UpdateAnnouncementInput>;

export const AnnouncementIdResult = z.strictObject({ id: z.uuid() });

// --- Bildirim gönderim özeti (salt okur, toplulaştırılmış) --------------------------------------------

export const NotificationSummaryQuery = z.strictObject({ from: IsoDate, to: IsoDate });
export type NotificationSummaryQueryValue = z.infer<typeof NotificationSummaryQuery>;

export const NotificationSummaryRowDto = z.strictObject({
  type: z.enum(NOTIFICATION_TYPES),
  sent: z.number().int(),
  read: z.number().int(),
});

export const AdminNotificationSummaryResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  items: z.array(NotificationSummaryRowDto),
  totals: z.strictObject({ sent: z.number().int(), read: z.number().int() }),
});
export type AdminNotificationSummaryResponseValue = z.infer<
  typeof AdminNotificationSummaryResponse
>;
