// `GET|PUT /api/v1/notifications/preferences` sözleşmeleri (045 §5.4; 002 §15). Matris kullanıcı
// düzeyindedir (`withUserScope`); satır yoksa varsayılan geçerlidir.
import { z } from 'zod';
import { NOTIFICATION_CHANNELS } from '../enums.ts';
import { PREFERENCE_KINDS } from '../notifications.ts';

export const PreferenceCellDto = z.strictObject({
  kind: z.enum(PREFERENCE_KINDS),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
  mandatory: z.boolean(),
});
export type PreferenceCellDtoValue = z.infer<typeof PreferenceCellDto>;

export const NotificationPreferencesResponse = z.strictObject({
  items: z.array(PreferenceCellDto),
});
export type NotificationPreferencesResponseValue = z.infer<typeof NotificationPreferencesResponse>;

/** Tür bilinmiyorsa şema reddeder; zorunlu kanal kapatma servis katmanında 422 `channel_mandatory`. */
export const PutNotificationPreferencesInput = z.strictObject({
  overrides: z
    .array(
      z.strictObject({
        kind: z.enum(PREFERENCE_KINDS),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .max(PREFERENCE_KINDS.length * NOTIFICATION_CHANNELS.length),
});
export type PutNotificationPreferencesInputValue = z.infer<typeof PutNotificationPreferencesInput>;
