// Yönetim servisi (P27a/b): Pano özeti, başvuru kuyruğu ve kararı, istatistikler. Tüm okuma/yazma
// `eda_readonly_admin` havuzundan `app.admin_*` SECURITY DEFINER fonksiyonlarıyla yapılır (tablo
// yetkisi yok); aktör her çağrıda veritabanında `super_admin` olarak doğrulanır. Çıktı içeriksizdir.
import type {
  AdminApplicationListResponseValue,
  AdminOverviewDtoValue,
  AdminStatsResponseValue,
  ListApplicationsQueryValue,
} from '@eda/contracts/api/admin';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';
import { parseTemplateParams, TEMPLATES } from '@eda/email/catalog';

export interface AdminServiceDeps {
  readonly db: AdminDb;
  /** `email.send` işini commit sonrası kuyruğa ekler (kaçarsa `email_outbox.sweep` yakalar). */
  readonly enqueueEmailSend: (
    deliveryId: string,
    template: 'verification_approved' | 'verification_rejected',
  ) => Promise<void>;
  readonly now?: () => Date;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : (v instanceof Date ? v : new Date(String(v))).toISOString();
const dayOf = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export function createAdminService(deps: AdminServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async overview(actorId: string): Promise<AdminOverviewDtoValue> {
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_overview($1)', [actorId]),
      );
      const x = (r.rows[0] ?? {}) as Record<string, unknown>;
      return {
        verifiedUsers: n(x.verified_users),
        orgs: {
          individual: n(x.orgs_individual),
          firm: n(x.orgs_firm),
          suspended: n(x.orgs_suspended),
        },
        applications: {
          pending: n(x.pending_applications),
          oldestPendingAt: iso(x.oldest_pending_at),
        },
        subscriptions: {
          trialing: n(x.subs_trialing),
          active: n(x.subs_active),
          pastDue: n(x.subs_past_due),
        },
        signups7d: n(x.signups_7d),
        today: {
          chatTurns: n(x.chat_turns_today),
          activeUsers: n(x.active_users_today),
          llmCalls: n(x.llm_calls_today),
          llmCostMicroUsd: n(x.llm_cost_today_micro_usd),
        },
      };
    },

    async listApplications(
      actorId: string,
      q: ListApplicationsQueryValue,
    ): Promise<AdminApplicationListResponseValue> {
      const limit = q.limit ?? 25;
      const r = await deps.db.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_list_applications($1, $2, $3, $4)', [
          actorId,
          q.status,
          limit + 1,
          q.cursor ?? null,
        ]),
      );
      const rows = r.rows as Record<string, unknown>[];
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((x) => ({
          userId: String(x.user_id),
          name: String(x.applicant_name),
          email: String(x.applicant_email),
          baro: String(x.baro),
          sicilNo: (x.sicil_no as string | null) ?? null,
          traineeRegistryNo: (x.trainee_registry_no as string | null) ?? null,
          status: x.verification_status as 'pending_verification' | 'verified' | 'rejected',
          source: (x.verification_source as string | null) ?? null,
          submittedAt: iso(x.submitted_at) ?? '',
          reviewedAt: iso(x.reviewed_at),
          rejectionReason: (x.reject_code as string | null) ?? null,
        })),
        nextCursor: rows.length > limit && last ? iso(last.submitted_at) : null,
      };
    },

    /** Onay veya ret; deneme, kredi, bildirim, e-posta kaydı ve denetim tek işlemdedir. */
    async decide(
      actorId: string,
      userId: string,
      decision: 'approved' | 'rejected',
      reasonCode?: string,
    ): Promise<{ userId: string; status: 'verified' | 'rejected' }> {
      const template = decision === 'approved' ? 'verification_approved' : 'verification_rejected';
      const meta = TEMPLATES[template];
      const params =
        decision === 'approved'
          ? parseTemplateParams('verification_approved', {
              trialDays: CONFIG_DEFAULTS['trial.days'],
              trialCredits: CONFIG_DEFAULTS['trial.credits'],
            })
          : parseTemplateParams('verification_rejected', {
              reasonCode,
              reapplyCooldownHours: CONFIG_DEFAULTS['auth.reapplyCooldownHours'],
            });
      const expiresAt = new Date(
        now().getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 3_600_000,
      );
      let deliveryId: string | null;
      try {
        deliveryId = await deps.db.withAdminWrite(async (tx) => {
          const r = await tx.query<{ id: string | null }>(
            'SELECT app.admin_decide_application($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) AS id',
            [
              actorId,
              userId,
              decision,
              decision === 'rejected' ? (reasonCode ?? null) : null,
              CONFIG_DEFAULTS['trial.days'],
              CONFIG_DEFAULTS['trial.credits'],
              meta.version,
              JSON.stringify(params),
              expiresAt,
            ],
          );
          return r.rows[0]?.id ?? null;
        });
      } catch (err) {
        const code = sqlState(err);
        // Karar beklemeyen veya olmayan başvuru bu kuyrukta yoktur: 404 (varlık/durum ayrışmaz).
        if (code === '55000' || code === 'P0002') throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
        if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
      if (deliveryId !== null) await deps.enqueueEmailSend(deliveryId, template);
      return { userId, status: decision === 'approved' ? 'verified' : 'rejected' };
    },

    async stats(actorId: string, from: string, to: string): Promise<AdminStatsResponseValue> {
      let rows: {
        daily: Record<string, unknown>[];
        funnel: Record<string, unknown>;
        br: Record<string, unknown>[];
      };
      try {
        rows = await deps.db.withAdmin(async (tx) => {
          const daily = await tx.query('SELECT * FROM app.admin_stats_daily($1, $2, $3)', [
            actorId,
            from,
            to,
          ]);
          const funnel = await tx.query('SELECT * FROM app.admin_stats_funnel($1, $2, $3)', [
            actorId,
            from,
            to,
          ]);
          const br = await tx.query('SELECT * FROM app.admin_stats_breakdown($1, $2, $3)', [
            actorId,
            from,
            to,
          ]);
          return {
            daily: daily.rows as Record<string, unknown>[],
            funnel: (funnel.rows[0] ?? {}) as Record<string, unknown>,
            br: br.rows as Record<string, unknown>[],
          };
        });
      } catch (err) {
        if (sqlState(err) === '22023')
          throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
        throw err;
      }
      const f = rows.funnel;
      return {
        from,
        to,
        daily: rows.daily.map((x) => ({
          day: dayOf(x.day),
          signups: n(x.signups),
          applications: n(x.applications),
          approvals: n(x.approvals),
          rejections: n(x.rejections),
          activeUsers: n(x.active_users),
          conversations: n(x.conversations),
          chatTurns: n(x.chat_turns),
          documents: n(x.documents),
          calendarEvents: n(x.calendar_events),
          llmCalls: n(x.llm_calls),
          llmErrors: n(x.llm_errors),
          llmCostMicroUsd: n(x.llm_cost_micro_usd),
        })),
        funnel: {
          signups: n(f.signups),
          emailVerified: n(f.email_verified),
          applications: n(f.applications),
          approved: n(f.approved),
          rejected: n(f.rejected),
          pending: n(f.pending),
          medianDecisionHours:
            f.median_decision_hours === null || f.median_decision_hours === undefined
              ? null
              : Number(f.median_decision_hours),
        },
        breakdown: rows.br.map((x) => ({
          dimension: x.dimension as 'task' | 'model_alias' | 'document_kind' | 'event_type',
          key: String(x.key),
          calls: n(x.calls),
          errors: n(x.errors),
          costMicroUsd: n(x.cost_micro_usd),
        })),
      };
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
