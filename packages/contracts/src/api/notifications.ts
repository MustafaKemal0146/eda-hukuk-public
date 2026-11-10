// `GET /api/v1/notifications`, `POST …/:id/read`, `POST …/read-all` sözleşmeleri (045 §6; 002 §15).
// Uygulama içi bildirim yalnız tür etiketi + zaman taşır; `payload` kimlik ve izinli alanlardır, taraf
// adı/başlık YOKTUR (Y-63). Sayfalama imleçlidir (yeniden eskiye).
import { z } from 'zod';
import { NOTIFICATION_TYPES } from '../enums.ts';

export const NOTIFICATIONS_PAGE_SIZE = 20;
export const NOTIFICATIONS_PAGE_MAX = 50;

export const NotificationDto = z.strictObject({
  id: z.uuid(),
  type: z.enum(NOTIFICATION_TYPES),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NotificationDtoValue = z.infer<typeof NotificationDto>;

export const ListNotificationsQuery = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATIONS_PAGE_MAX).optional(),
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListNotificationsQueryValue = z.infer<typeof ListNotificationsQuery>;

export const NotificationListResponse = z.strictObject({
  items: z.array(NotificationDto),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().min(0),
});
export type NotificationListResponseValue = z.infer<typeof NotificationListResponse>;

export const ReadAllResponse = z.strictObject({ updated: z.number().int().min(0) });
export type ReadAllResponseValue = z.infer<typeof ReadAllResponse>;
