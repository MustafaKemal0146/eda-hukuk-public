// Bildirim tercihleri servisi (045 §5; P28 D1): çözümlenmiş matris okur, geçersiz kılma yazar.
// Zorunlu (kilitli) kanalı kapatma 422 `channel_mandatory`; aynı istekte ilk geçersiz giriş tüm
// isteği reddeder (kısmi yazım yok). Hono bilmez.
import type {
  NotificationPreferencesResponseValue,
  PutNotificationPreferencesInputValue,
} from '@eda/contracts/api/notification-preferences';
import { AppError } from '@eda/contracts/errors';
import { overrideProblem, preferenceMatrix } from '@eda/contracts/notifications';
import type { UserTx } from '@eda/db';
import * as repo from '../../repositories/notifications/preferences.ts';

export interface PreferencesDb {
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
}

export interface PreferencesActor {
  readonly userId: string;
}

export function createNotificationPreferencesService(deps: { readonly db: PreferencesDb }) {
  async function read(
    a: PreferencesActor,
    tx: UserTx,
  ): Promise<NotificationPreferencesResponseValue> {
    return { items: preferenceMatrix(await repo.listOverrides(tx, a.userId)) };
  }

  return {
    get(a: PreferencesActor): Promise<NotificationPreferencesResponseValue> {
      return deps.db.withUserScope({ userId: a.userId }, (tx) => read(a, tx));
    },

    async put(
      a: PreferencesActor,
      input: PutNotificationPreferencesInputValue,
    ): Promise<NotificationPreferencesResponseValue> {
      for (const o of input.overrides) {
        // Şema tür kümesini zaten sınırlar; burada kanalın bu türde değiştirilebilirliği denetlenir.
        if (overrideProblem(o) !== null) {
          throw new AppError('VALIDATION_FAILED', { reason: 'channel_mandatory' });
        }
      }
      // Aynı (tür, kanal) tekrarında son değer kazanır.
      const last = new Map<string, (typeof input.overrides)[number]>();
      for (const o of input.overrides) last.set(`${o.kind}:${o.channel}`, o);
      return deps.db.withUserScope({ userId: a.userId }, async (tx) => {
        await repo.upsertOverrides(tx, a.userId, [...last.values()]);
        return read(a, tx);
      });
    },
  };
}

export type NotificationPreferencesService = ReturnType<
  typeof createNotificationPreferencesService
>;
