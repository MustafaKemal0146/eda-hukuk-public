// Bildirim tercihleri verisi (P28 D1 web dilimi): sözleşmeli API istemcisi (aynı origin). Server Action
// veya Route Handler yok; hata zarfı `ApiClientError` ile gelir, içerik loglanmaz.
import { ApiClientError, createDocumentsClient } from '@eda/api-client/endpoints/documents';
import { guardedFetch } from '../../lib/session-guard.ts';
import type {
  NotificationCell,
  NotificationChannelValue,
  PreferenceKindValue,
} from './notifications-model.ts';

const client = createDocumentsClient({ fetch: guardedFetch });

export { ApiClientError };

export async function loadNotificationPreferences(): Promise<NotificationCell[]> {
  return (await client.notifications.preferences()).items;
}

/** Tek hücreyi yazar (yalnız değişen hücre gönderilir) ve sunucunun çözümlenmiş matrisini döner. */
export async function saveNotificationPreference(
  kind: PreferenceKindValue,
  channel: NotificationChannelValue,
  enabled: boolean,
): Promise<NotificationCell[]> {
  return (await client.notifications.putPreferences({ overrides: [{ kind, channel, enabled }] }))
    .items;
}
