// Yönetim Denetim servisi: denetim günlüğü okuma ve hata özeti. Okuma `eda_readonly_admin` havuzundan
// `app.admin_audit_*` SECURITY DEFINER fonksiyonlarıyla yapılır (tablo yetkisi yok); aktör her çağrıda
// veritabanında `support|super_admin` olarak doğrulanır. Çıktı içeriksizdir: meta veri anahtarları
// fonksiyonda beyaz listelenir, burada değerler ayrıca güvenli-metin biçimine karşı süzülür.
import {
  AUDIT_ERROR_SOURCES,
  AUDIT_METADATA_KEYS,
  AUDIT_SAFE_TEXT,
  type AuditErrorSource,
  type AuditErrorsResponseValue,
  type AuditEventDtoValue,
  type AuditEventsQueryValue,
  type AuditEventsResponseValue,
  type AuditLoginFailuresResponseValue,
} from '@eda/contracts/api/admin-audit';
import { AUDIT_ACTIONS } from '@eda/contracts/audit-events';
import { AUDIT_ACTOR_TYPES } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { AdminDb } from '@eda/db/admin';

export interface AdminAuditServiceDeps {
  readonly db: AdminDb;
  readonly now?: () => Date;
}

const TOP_MAX = 20;
const DEFAULT_PAGE = 50;
const DEFAULT_WINDOW_DAYS = 7;

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const safeText = (v: unknown): string | null =>
  typeof v === 'string' && AUDIT_SAFE_TEXT.test(v) ? v : null;
const dayOf = (v: unknown): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);

/** Europe/Istanbul takvim günü (YYYY-MM-DD); gün sınırı fonksiyonlarla aynıdır. */
export function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const shiftDay = (day: string, delta: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/** Meta veri: yalnız beyaz listeli anahtar + güvenli skaler değer (savunma derinliği). */
export function safeMetadata(raw: unknown): AuditEventDtoValue['metadata'] {
  const out: Record<string, string | number | boolean> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const allowed = new Set<string>(AUDIT_METADATA_KEYS);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(k)) continue;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string') {
      const s = safeText(v);
      if (s !== null) out[k] = s;
    }
  }
  return out as AuditEventDtoValue['metadata'];
}

function sqlState(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

function mapDbError(err: unknown): never {
  const code = sqlState(err);
  if (code === '42501') throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
  if (code === '22023')
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  throw err;
}

export function createAdminAuditService(deps: AdminAuditServiceDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    async listEvents(actorId: string, q: AuditEventsQueryValue): Promise<AuditEventsResponseValue> {
      const to = q.to ?? istanbulDay(now());
      const from = q.from ?? shiftDay(to, -(DEFAULT_WINDOW_DAYS - 1));
      const limit = q.limit ?? DEFAULT_PAGE;
      const [cursorAt, cursorId] = q.cursor === undefined ? [null, null] : q.cursor.split('|');
      let rows: Record<string, unknown>[];
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query(
            'SELECT * FROM app.admin_audit_list($1, $2, $3, $4::date, $5::date, $6, $7::timestamptz, $8::uuid)',
            [
              actorId,
              q.action ?? null,
              q.actorType ?? null,
              from,
              to,
              limit + 1,
              cursorAt ?? null,
              cursorId ?? null,
            ],
          ),
        );
        rows = r.rows as Record<string, unknown>[];
      } catch (err) {
        return mapDbError(err);
      }
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const actions = new Set<string>(AUDIT_ACTIONS);
      const actorTypes = new Set<string>(AUDIT_ACTOR_TYPES);
      const items: AuditEventDtoValue[] = [];
      for (const x of page) {
        const action = String(x.action);
        const actorType = String(x.actor_type);
        // Katalog dışı olay/aktör türü gösterilmez (uydurma tür yok).
        if (!actions.has(action) || !actorTypes.has(actorType)) continue;
        items.push({
          id: String(x.event_id),
          at: (x.occurred_at instanceof Date
            ? x.occurred_at
            : new Date(String(x.occurred_at))
          ).toISOString(),
          action: action as AuditEventDtoValue['action'],
          actorType: actorType as AuditEventDtoValue['actorType'],
          actorId: x.actor_ref === null || x.actor_ref === undefined ? null : String(x.actor_ref),
          orgId: x.org_ref === null || x.org_ref === undefined ? null : String(x.org_ref),
          targetType: safeText(x.target_type),
          targetId: safeText(x.target_ref),
          metadata: safeMetadata(x.safe_metadata),
        });
      }
      return {
        from,
        to,
        items,
        nextCursor:
          rows.length > limit && last
            ? `${String(last.cursor_key)}|${String(last.event_id)}`
            : null,
      };
    },

    /** Yönetim girişi başarısızlık/kilitlenme sayaçları: yalnız sayı ve kod benzeri neden anahtarı. */
    async loginFailures(actorId: string): Promise<AuditLoginFailuresResponseValue> {
      let rows: Record<string, unknown>[];
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_audit_login_failures($1)', [actorId]),
        );
        rows = r.rows as Record<string, unknown>[];
      } catch (err) {
        return mapDbError(err);
      }
      const total = (key: string): number =>
        n(rows.find((x) => x.scope === 'total' && x.key === key)?.n);
      return {
        generatedAt: now().toISOString(),
        failures24h: total('failures24h'),
        failures7d: total('failures7d'),
        lockouts24h: total('lockouts24h'),
        byReason: rows
          .filter((x) => x.scope === 'reason')
          .map((x) => ({ key: safeText(x.key) ?? 'other', count: n(x.n) }))
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
          .slice(0, 10),
      };
    },

    async errorSummary(
      actorId: string,
      from: string,
      to: string,
    ): Promise<AuditErrorsResponseValue> {
      let rows: Record<string, unknown>[];
      try {
        const r = await deps.db.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_audit_error_summary($1, $2::date, $3::date)', [
            actorId,
            from,
            to,
          ]),
        );
        rows = r.rows as Record<string, unknown>[];
      } catch (err) {
        return mapDbError(err);
      }
      const sources = new Set<string>(AUDIT_ERROR_SOURCES);
      const days = new Map<string, Record<AuditErrorSource, number>>();
      for (let d = from; d <= to && days.size <= 93; d = shiftDay(d, 1)) {
        days.set(d, { ai_usage: 0, auth_failure: 0, email_delivery: 0 });
      }
      const byKey = new Map<string, { source: AuditErrorSource; key: string; count: number }>();
      const totals: Record<AuditErrorSource, number> = {
        ai_usage: 0,
        auth_failure: 0,
        email_delivery: 0,
      };
      for (const x of rows) {
        const source = String(x.source);
        const key = safeText(x.key) ?? 'other';
        if (!sources.has(source)) continue;
        const src = source as AuditErrorSource;
        const count = n(x.n);
        const bucket = days.get(dayOf(x.day));
        if (bucket !== undefined) bucket[src] += count;
        totals[src] += count;
        const id = `${src}:${key}`;
        const prev = byKey.get(id);
        if (prev === undefined) byKey.set(id, { source: src, key, count });
        else prev.count += count;
      }
      return {
        from,
        to,
        daily: [...days.entries()].map(([day, v]) => ({
          day,
          aiUsage: v.ai_usage,
          authFailure: v.auth_failure,
          emailDelivery: v.email_delivery,
        })),
        top: [...byKey.values()]
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
          .slice(0, TOP_MAX),
        totals: {
          aiUsage: totals.ai_usage,
          authFailure: totals.auth_failure,
          emailDelivery: totals.email_delivery,
        },
      };
    },
  };
}

export type AdminAuditService = ReturnType<typeof createAdminAuditService>;
