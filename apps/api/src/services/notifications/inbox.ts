// Bildirim kutusu servisi (045 §6; P28 D2c): liste (imleçli), okundu, tümünü okundu. Kiracı bağlamlıdır
// (`withTenant`); başka kullanıcının satırı görünmez/404. Hono bilmez.
import {
  type ListNotificationsQueryValue,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationListResponseValue,
  type ReadAllResponseValue,
} from '@eda/contracts/api/notifications';
import { AppError } from '@eda/contracts/errors';
import type { TenantTx } from '@eda/db';
import * as repo from '../../repositories/notifications/inbox.ts';

export interface InboxDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface InboxActor {
  readonly orgId: string;
  readonly userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(r: { createdAt: Date; id: string }): string {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}

function decodeCursor(c: string): { createdAt: Date; id: string } {
  const bad = () => new AppError('VALIDATION_CURSOR_INVALID');
  let text: string;
  try {
    text = Buffer.from(c, 'base64url').toString('utf8');
  } catch {
    throw bad();
  }
  const [iso, id] = text.split('|');
  const at = new Date(iso ?? '');
  if (!iso || !id || Number.isNaN(at.getTime()) || !UUID_RE.test(id)) throw bad();
  return { createdAt: at, id };
}

export function createNotificationInboxService(deps: { readonly db: InboxDb }) {
  const tenant = <T>(a: InboxActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);

  return {
    async list(
      a: InboxActor,
      q: ListNotificationsQueryValue,
    ): Promise<NotificationListResponseValue> {
      const limit = q.limit ?? NOTIFICATIONS_PAGE_SIZE;
      const before = q.cursor === undefined ? null : decodeCursor(q.cursor);
      return tenant(a, async (tx) => {
        const rows = await repo.listPage(tx, a, {
          unreadOnly: q.unread === true,
          before,
          limit,
        });
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          items: page.map((r) => ({
            id: r.id,
            type: r.type as NotificationListResponseValue['items'][number]['type'],
            payload: r.payload,
            readAt: r.readAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
          unreadCount: await repo.unreadCount(tx, a),
        };
      });
    },

    async read(a: InboxActor, id: string): Promise<void> {
      if (!UUID_RE.test(id)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
      const ok = await tenant(a, (tx) => repo.markRead(tx, a, id));
      if (!ok) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    },

    async readAll(a: InboxActor): Promise<ReadAllResponseValue> {
      return { updated: await tenant(a, (tx) => repo.markAllRead(tx, a)) };
    },
  };
}

export type NotificationInboxService = ReturnType<typeof createNotificationInboxService>;
