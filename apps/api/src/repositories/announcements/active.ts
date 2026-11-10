// `app.announcements` okuma deposu (uygulama şeridi; 041 §7). `eda_app` yalnız SELECT yetkisine sahiptir,
// tablo katalog sınıfıdır (RLS yok). Hedef kitle süzgeci burada uygulanır: `org_admins` yalnız
// owner/admin görür. SQL yalnız burada.
import type { TenantTx } from '@eda/db';

export interface ActiveAnnouncementRow {
  readonly id: string;
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly activeFrom: Date;
  readonly activeUntil: Date | null;
}

const d = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/** Şu an etkin duyurular; ciddiyet (critical > warning > info) sonra en yeni başlayan önce. */
export async function listActive(
  tx: TenantTx,
  q: { includeOrgAdmins: boolean; limit: number },
): Promise<ActiveAnnouncementRow[]> {
  const r = await tx.query(
    `SELECT id, severity, title, body,
            lower(active_during) AS active_from, upper(active_during) AS active_until
       FROM app.announcements
      WHERE active_during @> now()
        AND (audience = 'all' OR ($1::boolean AND audience = 'org_admins'))
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               lower(active_during) DESC, id DESC
      LIMIT $2`,
    [q.includeOrgAdmins, q.limit],
  );
  return r.rows.map((x) => {
    const row = x as Record<string, unknown>;
    return {
      id: String(row.id),
      severity: String(row.severity),
      title: String(row.title),
      body: String(row.body),
      activeFrom: d(row.active_from),
      activeUntil: row.active_until === null ? null : d(row.active_until),
    };
  });
}
