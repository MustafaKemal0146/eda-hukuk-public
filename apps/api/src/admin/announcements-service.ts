// Yönetim duyuru servisi (P27; 053-ekranlar/11 "Duyurular"): liste, yayımlama, düzenleme, yayından
// kaldırma ve bildirim gönderim özeti. Tüm okuma/yazma `eda_readonly_admin` havuzundan
// `app.admin_*` SECURITY DEFINER fonksiyonlarıyla yapılır; aktör ve yetki veritabanında doğrulanır,
// yazmalar aynı işlemde `audit_log` satırı üretir (metin içermez). Hono bilmez.
import type {
  AdminAnnouncementDtoValue,
  AdminAnnouncementListResponseValue,
  AdminNotificationSummaryResponseValue,
  CreateAnnouncementInputValue,
  ListAnnouncementsQueryValue,
  UpdateAnnouncementInputValue,
} from '@eda/contracts/api/admin-announcements';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface AdminAnnouncementsDeps {
  readonly db: AdminDb;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

/** Fonksiyon hatalarını HTTP hatasına çevirir: yok 404, biten duyuru 409, yetkisiz 403. */
function mapError(err: unknown): never {
  switch (sqlState(err)) {
    case 'P0002':
      throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    case '55000':
      throw new AppError('VALIDATION_CONFLICT', { reason: 'state_changed' });
    case '42501':
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
    case '22023':
      throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
    default:
      throw err;
  }
}

function dtoOf(x: Record<string, unknown>): AdminAnnouncementDtoValue {
  return {
    id: String(x.announcement_id),
    severity: x.severity as AdminAnnouncementDtoValue['severity'],
    audience: x.audience as AdminAnnouncementDtoValue['audience'],
    title: String(x.headline),
    body: String(x.message_text),
    activeFrom: iso(x.active_from) ?? '',
    activeUntil: iso(x.active_until),
    state: x.state as AdminAnnouncementDtoValue['state'],
    createdAt: iso(x.created_at) ?? '',
    updatedAt: iso(x.updated_at) ?? '',
  };
}

export function createAdminAnnouncementsService(deps: AdminAnnouncementsDeps) {
  return {
    async list(
      actorId: string,
      q: ListAnnouncementsQueryValue,
    ): Promise<AdminAnnouncementListResponseValue> {
      const limit = q.limit ?? 25;
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_list_announcements($1, $2, $3)', [
            actorId,
            limit + 1,
            q.cursor ?? null,
          ]),
        );
        const rows = r.rows as Record<string, unknown>[];
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
          items: page.map(dtoOf),
          nextCursor: rows.length > limit && last ? iso(last.created_at) : null,
        };
      } catch (err) {
        return mapError(err);
      }
    },

    async publish(actorId: string, input: CreateAnnouncementInputValue): Promise<{ id: string }> {
      try {
        const id = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ id: string }>(
            'SELECT app.admin_publish_announcement($1, $2, $3, $4, $5, $6, $7) AS id',
            [
              actorId,
              input.severity,
              input.audience,
              input.title,
              input.body,
              input.activeFrom ?? null,
              input.activeUntil ?? null,
            ],
          );
          return r.rows[0]?.id ?? '';
        });
        return { id };
      } catch (err) {
        return mapError(err);
      }
    },

    async update(
      actorId: string,
      id: string,
      input: UpdateAnnouncementInputValue,
    ): Promise<{ id: string }> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_update_announcement($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
            actorId,
            id,
            input.severity ?? null,
            input.audience ?? null,
            input.title ?? null,
            input.body ?? null,
            input.activeFrom ?? null,
            input.activeUntil !== undefined,
            input.activeUntil ?? null,
          ]),
        );
        return { id };
      } catch (err) {
        return mapError(err);
      }
    },

    async withdraw(actorId: string, id: string): Promise<{ id: string }> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_withdraw_announcement($1, $2)', [actorId, id]),
        );
        return { id };
      } catch (err) {
        return mapError(err);
      }
    },

    async notificationSummary(
      actorId: string,
      from: string,
      to: string,
    ): Promise<AdminNotificationSummaryResponseValue> {
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_notification_summary($1, $2, $3)', [actorId, from, to]),
        );
        const items = (r.rows as Record<string, unknown>[]).map((x) => ({
          type: x.notification_type as AdminNotificationSummaryResponseValue['items'][number]['type'],
          sent: n(x.sent_count),
          read: n(x.read_count),
        }));
        return {
          from,
          to,
          items,
          totals: {
            sent: items.reduce((a, b) => a + b.sent, 0),
            read: items.reduce((a, b) => a + b.read, 0),
          },
        };
      } catch (err) {
        return mapError(err);
      }
    },
  };
}

export type AdminAnnouncementsService = ReturnType<typeof createAdminAnnouncementsService>;
