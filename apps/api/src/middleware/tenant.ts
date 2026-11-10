// `tenant` (040 §5.10; 042 §7, §8.3): aktif büro ve üyelik her istekte DB'den (önbellek yok).
//  1. `activeOrganizationId` yoksa: `required` -> 409 `ORG_NO_ACTIVE`; `optional` -> tenant null.
//  2. `X-Eda-Org-Id` aktif büroyla eşleşmezse 409 `ORG_NO_ACTIVE` (`active_org_changed`).
//  3. Rol `withTenant` içinde `app.member_role()`'den (aktif üyelik, askıda olmayan büro ve kullanıcı);
//     yoksa: üyelik etkin ama büro askıdaysa 403 `AUTH_SUSPENDED` (`org_suspended`), aksi 403
//     `ORG_NOT_MEMBER`. `optional` rotalarda (ör. `GET /me`) çözülemeyen büro null bırakılır.
//  4. `org_settings` alt kümesi (MFA politikası + koşullu izin ayarları) aynı işlemde okunur.
// `eda_app` büro askı sütununu (`organizations.suspended_at`) okuyamaz; askı ayrımı üyelik +
// `member_role` ile yapılır.
import type { MemberRole } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { isPermission, requiresSettings } from '@eda/contracts/permissions';
import { getOrganizationSummary, listMembershipsOfUser, type TenantTx, type UserTx } from '@eda/db';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv, TenantVar } from '../context/types.ts';

export interface TenantDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx, role: MemberRole) => Promise<T>,
  ): Promise<T>;
  withUserScope<T>(ctx: { userId: string }, fn: (tx: UserTx) => Promise<T>): Promise<T>;
}

export function tenant(db: TenantDb): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    const s = c.get('session');
    const u = c.get('user');
    if (meta === undefined || s === undefined || u === undefined || meta.tenant === 'none') {
      c.set('tenant', null);
      return next();
    }
    const required = meta.tenant === 'required';
    const orgId = s.activeOrganizationId;
    if (orgId === null) {
      if (required) throw new AppError('ORG_NO_ACTIVE', { reason: 'no_active_org' });
      c.set('tenant', null);
      return next();
    }
    const expected = c.req.header('x-eda-org-id');
    if (expected !== undefined && expected !== orgId) {
      throw new AppError('ORG_NO_ACTIVE', { reason: 'active_org_changed' });
    }
    const permission = meta.permission;
    let resolved: TenantVar;
    try {
      resolved = await db.withTenant({ orgId, userId: s.userId }, async (tx, role) => {
        const org = await getOrganizationSummary(tx, orgId);
        if (org === null) throw new AppError('ORG_NOT_MEMBER');
        // Büro ayarı tek satır, aynı işlemde: MFA politikası her istekte, koşullu izin alt kümesi
        // yalnız koşullu izinde kullanılır (042 Açık Soru 3; P04b `mfaGate`).
        const r = await tx.query<{
          assistant_ai_chat_enabled: boolean;
          trainee_export_requires_approval: boolean;
          trainee_supervision: boolean;
          mfa_required_all: boolean;
        }>(
          `SELECT assistant_ai_chat_enabled, trainee_export_requires_approval, trainee_supervision,
                  mfa_required_all
           FROM app.org_settings WHERE org_id = $1`,
          [orgId],
        );
        const row = r.rows[0];
        const settings: TenantVar['settings'] =
          row !== undefined && isPermission(permission) && requiresSettings(permission, role)
            ? {
                assistantAiChatEnabled: row.assistant_ai_chat_enabled,
                traineeExportRequiresApproval: row.trainee_export_requires_approval,
                traineeSupervision: row.trainee_supervision,
              }
            : undefined;
        return {
          orgId,
          userId: s.userId,
          memberRole: role,
          orgKind: org.kind,
          mfaRequiredAll: row?.mfa_required_all === true,
          ...(settings === undefined ? {} : { settings }),
        };
      });
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'ORG_NOT_MEMBER')) throw err;
      if (!required) {
        c.set('tenant', null);
        return next();
      }
      const memberships = await db.withUserScope({ userId: s.userId }, (tx) =>
        listMembershipsOfUser(tx, s.userId),
      );
      const active = memberships.some((m) => m.organizationId === orgId && m.status === 'active');
      if (active && u.verificationStatus !== 'rejected' && u.verificationStatus !== 'suspended') {
        throw new AppError('AUTH_SUSPENDED', { reason: 'org_suspended' });
      }
      throw err;
    }
    c.set('tenant', resolved);
    await next();
  };
}
