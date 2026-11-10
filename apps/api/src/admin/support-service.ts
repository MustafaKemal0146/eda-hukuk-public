// Destek modülü servisi. Destek talebi tablosu vardır (`app.support_tickets`) ama konu ve gövde
// kullanıcı içeriğidir: panel yalnız kategori, öncelik, durum ve zamanı gösterir. Durum değişikliği
// yalnız `super_admin` (veritabanında yeniden doğrulanır) ve aynı işlemde denetim satırı yazar.
import type {
  AdminSupportOverviewDtoValue,
  AdminTicketListResponseValue,
  ListTicketsQueryValue,
  SetTicketStatusResultValue,
} from '@eda/contracts/api/admin-support';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface SupportServiceDeps {
  readonly db: AdminDb;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();

const WORKLIST_PER_KIND = 10;

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export function createSupportService(deps: SupportServiceDeps) {
  return {
    async overview(actorId: string): Promise<AdminSupportOverviewDtoValue> {
      const r = await deps.db.withAdmin(async (tx) => ({
        counts: await tx.query('SELECT * FROM app.admin_support_counts($1)', [actorId]),
        items: await tx.query('SELECT * FROM app.admin_support_worklist($1, $2)', [
          actorId,
          WORKLIST_PER_KIND,
        ]),
      }));
      const c = (r.counts.rows[0] ?? {}) as Record<string, unknown>;
      return {
        counts: {
          pendingApplications: n(c.pending_applications),
          oldestPendingAt: iso(c.oldest_pending_at),
          suspendedUsers: n(c.suspended_users),
          suspendedOrgs: n(c.suspended_orgs),
          unverifiedEmails: n(c.unverified_emails),
          oldestUnverifiedAt: iso(c.oldest_unverified_at),
          tickets: {
            open: n(c.tickets_open),
            inProgress: n(c.tickets_in_progress),
            waiting: n(c.tickets_waiting),
            urgent: n(c.tickets_urgent),
            oldestOpenAt: iso(c.oldest_open_ticket_at),
          },
        },
        items: (r.items.rows as Record<string, unknown>[]).map((x) => ({
          kind: x.item_kind as 'pending_application' | 'suspended_user' | 'unverified_email',
          refId: String(x.ref_id),
          partyEmail: String(x.party_email),
          status: String(x.item_status),
          sinceAt: iso(x.since_at) ?? '',
        })),
      };
    },

    async listTickets(
      actorId: string,
      q: ListTicketsQueryValue,
    ): Promise<AdminTicketListResponseValue> {
      const limit = q.limit ?? 25;
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_list_support_tickets($1, $2, $3, $4)', [
          actorId,
          q.status ?? null,
          limit + 1,
          q.cursor ?? null,
        ]),
      );
      const rows = r.rows as Record<string, unknown>[];
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((x) => ({
          ticketId: String(x.ticket_id),
          orgRef: String(x.org_ref),
          orgKind: String(x.org_kind),
          requesterEmail: (x.requester_email as string | null) ?? null,
          category: x.category as 'technical' | 'billing' | 'account' | 'kvkk' | 'other',
          priority: x.priority as 'low' | 'normal' | 'high' | 'urgent',
          status: x.ticket_status as 'open' | 'in_progress' | 'waiting' | 'closed',
          createdAt: iso(x.created_at) ?? '',
          updatedAt: iso(x.updated_at) ?? '',
          closedAt: iso(x.closed_at),
        })),
        nextCursor: rows.length > limit && last ? iso(last.created_at) : null,
        contentHidden: true,
      };
    },

    async setTicketStatus(
      actorId: string,
      ticketId: string,
      status: 'open' | 'in_progress' | 'waiting' | 'closed',
    ): Promise<SetTicketStatusResultValue> {
      try {
        await deps.db.withAdminWrite((tx) =>
          tx.query('SELECT app.admin_set_support_ticket_status($1, $2, $3)', [
            actorId,
            ticketId,
            status,
          ]),
        );
      } catch (err) {
        const code = sqlState(err);
        if (code === 'P0002') throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
        if (code === '55000')
          throw new AppError('VALIDATION_CONFLICT', { reason: 'state_changed' });
        if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
      return { ticketId, status };
    },
  };
}

export type SupportService = ReturnType<typeof createSupportService>;
