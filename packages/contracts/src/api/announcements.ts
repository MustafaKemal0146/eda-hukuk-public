// Platform duyurusu uygulama sözleşmesi (041 §7.5 `AnnouncementDto`; 002 §15 `GET /api/v1/announcements`).
// Metin düz metindir: HTML etiketi taşımaz, arayüzde yalnız metin düğümü olarak çizilir .
// Yönetim yüzeyi şemaları `admin-announcements.ts`'tedir.
import { z } from 'zod';
import { ANNOUNCEMENT_SEVERITIES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const AnnouncementDto = z.strictObject({
  id: z.uuid(),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES),
  title: z.string(),
  body: z.string(),
  activeFrom: IsoDateTime,
  activeUntil: IsoDateTime.nullable(),
});
export type AnnouncementDtoValue = z.infer<typeof AnnouncementDto>;

export const AnnouncementListResponse = z.strictObject({ items: z.array(AnnouncementDto) });
export type AnnouncementListResponseValue = z.infer<typeof AnnouncementListResponse>;

/** Uygulama şeridine bir seferde dönen en çok etkin duyuru sayısı (ciddiyeti yüksek önce). */
export const ANNOUNCEMENTS_ACTIVE_MAX = 5;
