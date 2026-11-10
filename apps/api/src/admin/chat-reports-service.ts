// "Sohbetler ve raporlar" servisi: `eda_readonly_admin` havuzundan `app.admin_chat_report_*` SECURITY
// DEFINER fonksiyonlarını çağırır (0045). Fonksiyonlar yalnız toplulaştırılmış sayı döndürür; sohbet ve
// mesaj içeriği, kullanıcı ve büro kimliği hiçbir aşamada okunmaz. Çıktı Zod ile süzülür (strictObject).
import {
  ChatReportsResponse,
  type ChatReportsResponseValue,
} from '@eda/contracts/api/admin-chat-reports';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface ChatReportsServiceDeps {
  readonly db: AdminDb;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const dayOf = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);

type Row = Record<string, unknown>;
const bucket = (rows: readonly Row[], dimension: string): Row[] =>
  rows.filter((r) => r.dimension === dimension);

export function createChatReportsService(deps: ChatReportsServiceDeps) {
  return {
    async report(actorId: string, from: string, to: string): Promise<ChatReportsResponseValue> {
      let daily: Row[];
      let br: Row[];
      try {
        const out = await deps.db.withAdmin(async (tx) => {
          const d = await tx.query('SELECT * FROM app.admin_chat_report_daily($1, $2, $3)', [
            actorId,
            from,
            to,
          ]);
          const b = await tx.query('SELECT * FROM app.admin_chat_report_breakdown($1, $2, $3)', [
            actorId,
            from,
            to,
          ]);
          return { d: d.rows as Row[], b: b.rows as Row[] };
        });
        daily = out.d;
        br = out.b;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === '22023')
          throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
        if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
        throw err;
      }
      const up = n(bucket(br, 'feedback_rating').find((r) => r.key === 'up')?.total);
      const down = n(bucket(br, 'feedback_rating').find((r) => r.key === 'down')?.total);
      // Çıktı şemadan geçirilir: tanımsız alan veya beklenmeyen kod değeri sızıntıyı değil hatayı doğurur.
      return ChatReportsResponse.parse({
        from,
        to,
        daily: daily.map((x) => ({
          day: dayOf(x.day),
          conversations: n(x.conversations),
          messages: n(x.messages),
          userMessages: n(x.user_messages),
          turns: n(x.turns),
          turnErrors: n(x.turns_error),
          avgTurnSeconds: x.avg_turn_seconds === null ? null : Number(x.avg_turn_seconds),
          activeOrgs: n(x.active_orgs),
          chatCalls: n(x.chat_calls),
          petitionCalls: n(x.petition_calls),
          sourcesDecision: n(x.sources_decision),
          sourcesLegislation: n(x.sources_legislation),
          feedbackUp: n(x.feedback_up),
          feedbackDown: n(x.feedback_down),
        })),
        modes: bucket(br, 'mode').map((r) => ({
          mode: r.key,
          calls: n(r.total),
          errors: n(r.errors),
        })),
        aliases: bucket(br, 'model_alias').map((r) => ({
          alias: r.key,
          turns: n(r.total),
          errors: n(r.errors),
        })),
        tools: bucket(br, 'tool').map((r) => ({
          tool: r.key,
          calls: n(r.total),
          errors: n(r.errors),
          errorRate: n(r.total) === 0 ? 0 : n(r.errors) / n(r.total),
          avgDurationMs: n(r.avg_ms),
        })),
        sources: bucket(br, 'source_kind').map((r) => ({ kind: r.key, count: n(r.total) })),
        sourceOrigins: bucket(br, 'source_origin').map((r) => ({
          origin: r.key,
          count: n(r.total),
        })),
        feedback: {
          up,
          down,
          downCategories: bucket(br, 'feedback_category').map((r) => ({
            category: r.key,
            count: n(r.total),
          })),
        },
        orgKinds: bucket(br, 'org_kind').map((r) => ({ kind: r.key, conversations: n(r.total) })),
        // `masking_applied` yalnız akış bildirimidir, kalıcı kayıt yoktur: sayaç uydurulmaz.
        unavailable: ['masking_notices'],
      });
    },
  };
}

export type ChatReportsService = ReturnType<typeof createChatReportsService>;
