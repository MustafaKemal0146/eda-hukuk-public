// Büro yönetimi servisi (042 §4, §7; 002 §15 "Büro"; P04b). Hono bilmez. Kimlik tablosu yazımları
// yalnız `Identity.org` (authDb) ile, `app` okumaları `withTenant` ile ve AYRI işlemlerde (Y-98).
//  - Davet (042 §4.1): davet eden `verified`; rol kuralı (`owner` her rolü, `admin` owner/admin
//    dışını); kendi/mevcut üye adresi 409 `already_member`; süresi dolmuş bekleyen davetler iptal,
//    geçerli bekleyen davet 409 `invitation_pending`; koltuk ön denetimi (üye + bekleyen davet <
//    kapasite) 409 `SEAT_LIMIT_REACHED`; hedef adres başı saatlik sınır (`auth-email-out`) 429.
//    E-posta outbox kaydı başarısızsa davet iptal edilir (telafi). Denetim `org.member.invited`.
//  - Üye askı/rol/çıkarma (042 §4.4): kurallar `memberActionError`; son etkin `owner` askıya
//    alınamaz/çıkarılamaz (409 `ORG_MEMBER_TRANSFER_REQUIRED` `is_owner`); askı/çıkarmada hedefin bu
//    büroyu aktif gösteren TÜM oturumlarında aktif büro NULL'lanır (DB + Valkey; KK-040-10);
//    çıkarmada içerik işlemi yapana devredilir (`app.transfer_member_content`).
// Davet kimliği taşıyıcı belirteçtir: yanıtta, günlükte, denetimde yalnız `invitationRef` özeti.
import type {
  InvitationCanceledDto,
  InvitationCreatedDto,
  InvitationCreateInput,
  InvitationListDto,
  MemberDto,
  MemberListDto,
  MemberPatchInput,
  MemberRemovedDto,
  OrgDto,
} from '@eda/contracts/api/org';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { MemberRole, OrgKind, VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { getOrganizationSummary, listOrgMembers, type TenantTx } from '@eda/db';
import { normalizeEmail } from '@eda/legal/text';
import type { AuditWriter } from '../../auth/audit.ts';
import {
  type AuthEmails,
  type InvitationRow,
  invitationRef,
  inviteRoleError,
  type MemberAction,
  memberActionError,
  type OrgIdentity,
} from '../../auth/index.ts';

export interface OrgDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface OrgServiceDeps {
  readonly org: OrgIdentity;
  readonly db: OrgDb;
  readonly emails: Pick<AuthEmails, 'invitation'>;
  readonly audit: AuditWriter;
  /** Hedef adres başı saatlik e-posta sınırı (`auth-email-out`); false = sınır aşıldı. */
  readonly allowEmail: (email: string) => Promise<boolean>;
  readonly now?: () => Date;
}

export interface OrgActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
  readonly orgKind: OrgKind;
  readonly verificationStatus: VerificationStatus;
}

interface SeatUsage {
  readonly capacity: number;
  readonly used: number;
  readonly pendingInvitations: number;
}

async function seatUsage(db: OrgDb, a: OrgActor): Promise<SeatUsage> {
  return db.withTenant({ orgId: a.orgId, userId: a.userId }, async (tx) => {
    const r = await tx.query<{ capacity: number; used: number; pending_invitations: number }>(
      'SELECT capacity, used, pending_invitations FROM app.org_seat_usage($1)',
      [a.orgId],
    );
    const row = r.rows[0];
    if (row === undefined) throw new AppError('ORG_NOT_MEMBER');
    return { capacity: row.capacity, used: row.used, pendingInvitations: row.pending_invitations };
  });
}

const iso = (d: Date) => new Date(d).toISOString();

function invitationDto(i: InvitationRow) {
  return {
    ref: invitationRef(i.id),
    email: i.email,
    role: i.role,
    status: i.status,
    expiresAt: iso(i.expiresAt),
    createdAt: iso(i.createdAt),
  };
}

export function createOrgService(deps: OrgServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function memberDto(a: OrgActor, memberId: string): Promise<MemberDto> {
    const rows = await deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, (tx) =>
      listOrgMembers(tx, a.orgId),
    );
    const m = rows.find((r) => r.id === memberId);
    if (m === undefined) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'member' });
    return {
      id: m.id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      status: m.status,
      joinedAt: iso(m.createdAt),
    };
  }

  async function targetMember(a: OrgActor, memberId: string) {
    const m = await deps.org.member(a.orgId, memberId);
    if (m === null) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'member' });
    return m;
  }

  async function assertNotLastOwner(a: OrgActor, memberId: string, role: MemberRole) {
    if (role !== 'owner') return;
    if ((await deps.org.activeOwnersExcept(a.orgId, memberId)) === 0) {
      throw new AppError('ORG_MEMBER_TRANSFER_REQUIRED', { reason: 'is_owner' });
    }
  }

  return {
    async getOrg(a: OrgActor): Promise<OrgDto> {
      const summary = await deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, (tx) =>
        getOrganizationSummary(tx, a.orgId),
      );
      if (summary === null) throw new AppError('ORG_NOT_MEMBER');
      const seats = await seatUsage(deps.db, a);
      return { id: summary.id, name: summary.name, kind: summary.kind, role: a.memberRole, seats };
    },

    async listInvitations(a: OrgActor): Promise<InvitationListDto> {
      const rows = await deps.org.pendingInvitations(a.orgId, now());
      return { items: rows.map(invitationDto) };
    },

    async createInvitation(
      a: OrgActor,
      input: InvitationCreateInput,
    ): Promise<InvitationCreatedDto> {
      if (a.verificationStatus !== 'verified') throw new AppError('AUTH_PENDING_VERIFICATION');
      const roleErr = inviteRoleError(a.memberRole, input.role);
      if (roleErr !== null) throw roleErr;
      const email = normalizeEmail(input.email);
      if (email === null) {
        throw new AppError('VALIDATION_FAILED', {
          fields: [{ path: 'body.email', issue: 'invalid_format' }],
        });
      }
      const self = await deps.org.user(a.userId);
      if (self?.email === email || (await deps.org.isMemberEmail(a.orgId, email))) {
        throw new AppError('VALIDATION_CONFLICT', { reason: 'already_member' });
      }
      const at = now();
      await deps.org.cancelExpiredPending(a.orgId, email, at);
      const pending = await deps.org.pendingInvitations(a.orgId, at);
      if (pending.some((p) => p.email === email)) {
        throw new AppError('VALIDATION_CONFLICT', { reason: 'invitation_pending' });
      }
      const seats = await seatUsage(deps.db, a);
      if (seats.used + seats.pendingInvitations >= seats.capacity) {
        throw new AppError('SEAT_LIMIT_REACHED', {
          reason: 'seat_limit',
          meta: { seats: seats.capacity, used: seats.used + seats.pendingInvitations },
        });
      }
      if (!(await deps.allowEmail(email))) {
        throw new AppError('RATE_LIMITED', { meta: { retryAfterSec: 3600 } });
      }
      const expiresAt = new Date(at.getTime() + CONFIG_DEFAULTS['auth.inviteTtlHours'] * 3_600_000);
      const inv = await deps.org.insertInvitation({
        orgId: a.orgId,
        email,
        role: input.role,
        inviterId: a.userId,
        expiresAt,
      });
      try {
        await deps.emails.invitation(a.userId, inv.id, input.role, expiresAt);
      } catch (err) {
        await deps.org.setInvitationStatus(inv.id, 'canceled');
        throw err;
      }
      const ref = invitationRef(inv.id);
      await deps.audit({
        action: 'org.member.invited',
        userId: a.userId,
        orgId: a.orgId,
        targetType: 'invitation',
        targetId: null,
        metadata: { invitationRef: ref, role: input.role },
      });
      return { ref, role: input.role, status: 'pending', expiresAt: iso(expiresAt) };
    },

    async cancelInvitation(a: OrgActor, ref: string): Promise<InvitationCanceledDto> {
      const rows = await deps.org.pendingInvitations(a.orgId, now());
      const inv = rows.find((r) => invitationRef(r.id) === ref);
      if (inv === undefined) {
        throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'invitation' });
      }
      const roleErr = inviteRoleError(a.memberRole, inv.role);
      if (roleErr !== null) throw roleErr;
      if (!(await deps.org.setInvitationStatus(inv.id, 'canceled'))) {
        throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'invitation' });
      }
      return { ref, status: 'canceled' };
    },

    async listMembers(a: OrgActor): Promise<MemberListDto> {
      const rows = await deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, (tx) =>
        listOrgMembers(tx, a.orgId),
      );
      return {
        items: rows.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          status: m.status,
          joinedAt: iso(m.createdAt),
        })),
      };
    },

    async patchMember(a: OrgActor, memberId: string, input: MemberPatchInput): Promise<MemberDto> {
      const target = await targetMember(a, memberId);
      const actor = { userId: a.userId, role: a.memberRole };
      const actions: MemberAction[] = [];
      if (input.role !== undefined && input.role !== target.role) {
        actions.push({ kind: 'role', role: input.role });
      }
      if (input.status !== undefined && input.status !== target.status) {
        actions.push({ kind: 'status', status: input.status });
      }
      for (const action of actions) {
        const err = memberActionError(actor, target, action);
        if (err !== null) throw err;
      }
      if (input.status === 'suspended' && target.status !== 'suspended') {
        await assertNotLastOwner(a, memberId, target.role);
      }
      if (actions.length > 0) {
        await deps.org.updateMember(
          memberId,
          {
            ...(input.role === undefined ? {} : { role: input.role }),
            ...(input.status === undefined ? {} : { status: input.status }),
          },
          now(),
        );
      }
      for (const action of actions) {
        if (action.kind === 'role') {
          await deps.audit({
            action: 'org.member.role_changed',
            userId: a.userId,
            orgId: a.orgId,
            targetType: 'member',
            targetId: memberId,
            metadata: { memberId, oldRole: target.role, newRole: action.role },
          });
        } else if (action.kind === 'status') {
          if (action.status === 'suspended') {
            await deps.org.clearActiveOrg(target.userId, a.orgId);
          }
          await deps.audit({
            action:
              action.status === 'suspended' ? 'org.member.suspended' : 'org.member.unsuspended',
            userId: a.userId,
            orgId: a.orgId,
            targetType: 'member',
            targetId: memberId,
            metadata: { memberId },
          });
        }
      }
      return memberDto(a, memberId);
    },

    async removeMember(a: OrgActor, memberId: string): Promise<MemberRemovedDto> {
      const target = await targetMember(a, memberId);
      const err = memberActionError({ userId: a.userId, role: a.memberRole }, target, {
        kind: 'remove',
      });
      if (err !== null) throw err;
      await assertNotLastOwner(a, memberId, target.role);
      // İçerik devri: hedef belirtilmediğinden işlemi yapana; denetim olayını
      // (`org.conversations.transferred`) fonksiyon yazar.
      await deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, (tx) =>
        tx.query('SELECT app.transfer_member_content($1, $2)', [target.userId, a.userId]),
      );
      await deps.org.deleteMember(memberId);
      await deps.org.clearActiveOrg(target.userId, a.orgId);
      await deps.audit({
        action: 'org.member.removed',
        userId: a.userId,
        orgId: a.orgId,
        targetType: 'member',
        targetId: memberId,
        metadata: { memberId },
      });
      return { id: memberId, status: 'removed' };
    },
  };
}

export type OrgService = ReturnType<typeof createOrgService>;
