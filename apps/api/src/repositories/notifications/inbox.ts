// `app.notifications` okuma deposu (uygulama içi bildirim kutusu; 045 §6). `eda_app` yalnız SELECT ve
// `read_at` UPDATE yetkisine sahiptir (yazım worker/tanımlayıcı fonksiyonlarındadır). RLS kiracı +
// alıcı kapsamlıdır; yine de sorgular açıkça `org_id` ve `user_id` ile süzer. SQL yalnız burada.
import type { TenantTx } from '@eda/db';

export interface NotificationRow {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

const d = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

function rowFrom(r: Record<string, unknown>): NotificationRow {
  return {
    id: String(r.id),
    type: String(r.type),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    readAt: r.read_at === null || r.read_at === undefined ? null : d(r.read_at),
    createdAt: d(r.created_at),
  };
}

/** Yeniden eskiye; imleç `(created_at, id)` çiftidir. `limit + 1` satır okunur (sonraki sayfa var mı). */
export async function listPage(
  tx: TenantTx,
  a: { orgId: string; userId: string },
  q: { unreadOnly: boolean; before: { createdAt: Date; id: string } | null; limit: number },
): Promise<NotificationRow[]> {
  const r = await tx.query(
    `SELECT id, type, payload, read_at, created_at
       FROM app.notifications
      WHERE org_id = $1 AND user_id = $2
        AND ($3::boolean IS FALSE OR read_at IS NULL)
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $6`,
    [
      a.orgId,
      a.userId,
      q.unreadOnly,
      q.before?.createdAt ?? null,
      q.before?.id ?? null,
      q.limit + 1,
    ],
  );
  return r.rows.map((x) => rowFrom(x as Record<string, unknown>));
}

export async function unreadCount(
  tx: TenantTx,
  a: { orgId: string; userId: string },
): Promise<number> {
  const r = await tx.query(
    `SELECT count(*)::int AS n FROM app.notifications
      WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL`,
    [a.orgId, a.userId],
  );
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

/** Tek bildirimi okundu yapar (idempotent: zaten okunmuşsa dokunmaz). Bulunamazsa `false`. */
export async function markRead(
  tx: TenantTx,
  a: { orgId: string; userId: string },
  id: string,
): Promise<boolean> {
  const r = await tx.query(
    `UPDATE app.notifications SET read_at = COALESCE(read_at, now())
      WHERE org_id = $1 AND user_id = $2 AND id = $3
      RETURNING id`,
    [a.orgId, a.userId, id],
  );
  return r.rows.length > 0;
}

export async function markAllRead(
  tx: TenantTx,
  a: { orgId: string; userId: string },
): Promise<number> {
  const r = await tx.query(
    `UPDATE app.notifications SET read_at = now()
      WHERE org_id = $1 AND user_id = $2 AND read_at IS NULL
      RETURNING id`,
    [a.orgId, a.userId],
  );
  return r.rows.length;
}
