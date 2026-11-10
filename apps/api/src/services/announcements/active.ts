// Etkin duyuru servisi (041 §7; salt okur). Kiracı bağlamlıdır; hedef kitle (`org_admins`) üyelik
// rolüne göre süzülür. Hono bilmez.
import {
  ANNOUNCEMENTS_ACTIVE_MAX,
  type AnnouncementListResponseValue,
} from '@eda/contracts/api/announcements';
import type { TenantTx } from '@eda/db';
import * as repo from '../../repositories/announcements/active.ts';

export interface AnnouncementsDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface AnnouncementsActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: string;
}

const MANAGER_ROLES: readonly string[] = ['owner', 'admin'];

export function createAnnouncementsService(deps: { readonly db: AnnouncementsDb }) {
  return {
    async listActive(a: AnnouncementsActor): Promise<AnnouncementListResponseValue> {
      const rows = await deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, (tx) =>
        repo.listActive(tx, {
          includeOrgAdmins: MANAGER_ROLES.includes(a.memberRole),
          limit: ANNOUNCEMENTS_ACTIVE_MAX,
        }),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          severity: r.severity as AnnouncementListResponseValue['items'][number]['severity'],
          title: r.title,
          body: r.body,
          activeFrom: r.activeFrom.toISOString(),
          activeUntil: r.activeUntil?.toISOString() ?? null,
        })),
      };
    },
  };
}

export type AnnouncementsService = ReturnType<typeof createAnnouncementsService>;
