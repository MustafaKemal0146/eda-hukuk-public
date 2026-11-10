// Kimlik denetim olayları (042 §13; 031 §8.1): yazım `appDb` üzerinden `app.audit_append`; aktif büro
// varsa büro zinciri, yoksa platform zinciri (aktör oturum bağından; kimlik öncesi `system`).
// `metadata` içeriksizdir (kimlik, kod). Olay adı katalog dışıysa DB 23514 verir (KK-042-20).
// Denetim yazımı kimlik akışını kırmaz: hata yalnız günlüğe kod olarak yazılır.
import type { AuditAction } from '@eda/contracts/audit-events';
import { AppError } from '@eda/contracts/errors';
import type { NoTenantTx, TenantTx, UserTx } from '@eda/db';
import type { EdaLogger } from '@eda/observability/logger';

export interface AppDbAccess {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
  withNoTenant<T>(reason: 'pre_auth_audit', fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
}

export interface AuditEvent {
  readonly action: AuditAction;
  readonly userId?: string | null;
  readonly orgId?: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
  readonly ipTrunc?: string | null;
}

const SQL = 'SELECT app.audit_append($1, $2, $3, $4, $5::jsonb, $6)';

export async function appendAudit(
  e: AuditEvent,
  scope: 'org' | 'platform',
  tx: TenantTx | UserTx | NoTenantTx,
): Promise<void> {
  await tx.query(SQL, [
    e.action,
    scope,
    e.targetType,
    e.targetId,
    JSON.stringify(e.metadata ?? {}),
    e.ipTrunc ?? null,
  ]);
}

export function createAuditWriter(db: AppDbAccess, logger: EdaLogger) {
  return async function writeAudit(e: AuditEvent): Promise<void> {
    try {
      if (e.orgId && e.userId) {
        try {
          await db.withTenant({ orgId: e.orgId, userId: e.userId }, (tx) =>
            appendAudit(e, 'org', tx),
          );
          return;
        } catch (err) {
          if (!(err instanceof AppError && err.code === 'ORG_NOT_MEMBER')) throw err;
        }
      }
      if (e.userId) {
        await db.withUserScope({ userId: e.userId }, (tx) => appendAudit(e, 'platform', tx));
        return;
      }
      await db.withNoTenant('pre_auth_audit', (tx) => appendAudit(e, 'platform', tx));
    } catch (err) {
      logger.error({
        event: 'dependency.degraded',
        dependency: 'audit',
        action: e.action,
        errorType: err instanceof Error ? err.name : 'unknown',
      });
    }
  };
}

export type AuditWriter = ReturnType<typeof createAuditWriter>;
