// Büro kuralları ve Better Auth `organizationHooks` (042 §2.6, §4; P04b). Kurallar saf fonksiyonlardır
// ve hem `/api/v1/org/*` servisleri hem eklenti kancaları tarafından kullanılır. Better Auth'un büro
// yönetim uçları (`organization/invite-member|update-member-role|remove-member|…`) yol izin
// listesinde KAPALIDIR (KK-P04b-5); davet ve üye yönetimi yalnız `/api/v1/org/*` uçlarındadır. Bu
// nedenle eklentinin oluşturma/rol/çıkarma kancaları sunucu tarafı yanlış kullanıma karşı fail-closed
// reddeder (savunma derinliği). Kabul akışı (`organization/accept-invitation`) eklentidedir:
// `beforeAcceptInvitation` büro askısı ve meslek profili, `afterAcceptInvitation` doğrulama devri ve
// denetim olayıdır. Davet kimliği taşıyıcı belirteçtir: denetimde yalnız `invitationRef` (özet).
import { PROFESSION_ROLES } from '@eda/contracts/api/org';
import type { MemberRole } from '@eda/contracts/enums';
import { AppError, errorMessageTr } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import { APIError } from 'better-auth/api';
import type { AppDbAccess, AuditWriter } from '../audit.ts';
import { invitationRef, type MemberRow, type OrgStore } from '../org-store.ts';

export interface OrgHookDeps {
  readonly store: OrgStore;
  readonly appDb: AppDbAccess;
  readonly audit: AuditWriter;
  readonly now: () => Date;
}

const isProfessionRole = (role: string): boolean =>
  (PROFESSION_ROLES as readonly string[]).includes(role);

/** Davet edenin rolüne göre davet edilebilen rol (042 §4.1 adım 2; koşul c). */
export function inviteRoleError(actorRole: MemberRole, targetRole: MemberRole): AppError | null {
  if (targetRole === 'owner') return new AppError('ORG_ROLE_INSUFFICIENT');
  const d = can({ surface: 'app', memberRole: actorRole }, 'org:member_invite', { targetRole });
  return d.allow ? null : new AppError('ORG_ROLE_INSUFFICIENT');
}

export type MemberAction =
  | { readonly kind: 'role'; readonly role: Exclude<MemberRole, 'owner'> }
  | { readonly kind: 'status'; readonly status: 'active' | 'suspended' }
  | { readonly kind: 'remove' };

/**
 * Üye işlemi kuralları (042 §4.4; KK-P04b-3): kimse kendi üyeliğini yönetemez (rol yükseltme dahil);
 * `admin` yalnız `owner` tarafından atanır/alınır; `admin` `owner` veya başka `admin` üzerinde işlem
 * yapamaz; `owner` rolü `PATCH` ile atanamaz ve değiştirilemez (aktarım ayrı akıştır). Son `owner`
 * kuralı servis katmanındadır (sayım gerekir).
 */
export function memberActionError(
  actor: { readonly userId: string; readonly role: MemberRole },
  target: MemberRow,
  action: MemberAction,
): AppError | null {
  if (actor.userId === target.userId)
    return new AppError('AUTH_FORBIDDEN', { reason: 'policy_denied' });
  const subject = { surface: 'app' as const, memberRole: actor.role };
  const onTarget = can(subject, 'org:member_manage', {
    targetRole: target.role,
    targetIsOwner: target.role === 'owner',
  });
  if (!onTarget.allow) return new AppError('ORG_ROLE_INSUFFICIENT');
  if (action.kind === 'role') {
    if (target.role === 'owner') return new AppError('AUTH_FORBIDDEN', { reason: 'policy_denied' });
    const assign = can(subject, 'org:member_manage', { targetRole: action.role });
    if (!assign.allow) return new AppError('ORG_ROLE_INSUFFICIENT');
  }
  return null;
}

/** Uygulama hatasını Better Auth biçimine çevirir (`{ code, message, reason? }`; 042 §2.6). */
export function toApiError(
  e: AppError,
  status: 'FORBIDDEN' | 'BAD_REQUEST' | 'UNPROCESSABLE_ENTITY' | 'CONFLICT' | 'TOO_MANY_REQUESTS',
  headers?: Record<string, string>,
): APIError {
  return new APIError(
    status,
    {
      code: e.code,
      message: errorMessageTr(e.code, e.reason),
      ...(e.reason === null ? {} : { reason: e.reason }),
    },
    headers,
  );
}

/** Kabul/okuma/ret öncesi genel davet hatası (davetin varlığı ve sahibi ayrışmaz; 042 §4.2). */
export const INVITATION_INVALID = (): APIError =>
  new APIError('BAD_REQUEST', {
    code: 'INVITATION_INVALID',
    message: 'Davet geçersiz veya süresi dolmuş. Büro yöneticinizden yeni davet isteyin.',
  });

const DISALLOWED = (): APIError =>
  new APIError('FORBIDDEN', {
    code: 'AUTH_FORBIDDEN',
    message: 'Büro üyelik işlemleri yalnız büro yönetimi ekranından yapılır.',
  });

export function createOrganizationHooks(deps: OrgHookDeps) {
  return {
    // Better Auth büro oluşturma/davet/rol/çıkarma uçları kapalıdır (allowlist + disabledPaths);
    // sunucu API'siyle çağrılırsa da reddedilir. Kurallar `/api/v1/org/*` servislerindedir.
    beforeCreateOrganization: async () => {
      throw DISALLOWED();
    },
    beforeCreateInvitation: async () => {
      throw DISALLOWED();
    },
    beforeUpdateMemberRole: async () => {
      throw DISALLOWED();
    },
    beforeRemoveMember: async () => {
      throw DISALLOWED();
    },
    beforeAddMember: async (data: { member: { userId: string } }) => {
      // Davet kabulü üyeliği adaptörle doğrudan yazar (bu kanca çağrılmaz); personel ve bayi
      // kullanıcısı için asıl koruma DB tetikleyicileridir (KK-P04b-11).
      const u = await deps.store.user(data.member.userId);
      if (u === null || u.platformRole !== 'user') {
        throw toApiError(
          new AppError('AUTH_FORBIDDEN', { reason: 'staff_on_app_surface' }),
          'FORBIDDEN',
        );
      }
      throw DISALLOWED();
    },
    beforeAcceptInvitation: async (data: {
      invitation: { id: string; organizationId: string; role: string };
      user: { id: string };
    }) => {
      const org = await deps.store.org(data.invitation.organizationId);
      if (org === null || org.closedAt !== null) throw INVITATION_INVALID();
      if (org.suspendedAt !== null) {
        throw toApiError(new AppError('AUTH_SUSPENDED', { reason: 'org_suspended' }), 'FORBIDDEN');
      }
      if (!isProfessionRole(data.invitation.role)) return;
      const u = await deps.store.user(data.user.id);
      if (u?.verificationStatus === 'verified') return;
      // Meslek beyanı kabulden önce `POST /me/lawyer-application` ile verilir; profil
      // yoksa kabul 422 `profession_required`. Varsa kaynak `org_invitation` olarak işaretlenir
      // (davet hâlâ `pending`; fonksiyon idempotenttir).
      const has = await deps.appDb.withUserScope({ userId: data.user.id }, async (tx) => {
        const r = await tx.query<{ ok: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM app.lawyer_profiles WHERE user_id = $1) AS ok',
          [data.user.id],
        );
        if (r.rows[0]?.ok !== true) return false;
        await tx.query('SELECT app.mark_profile_invitation_source($1)', [data.invitation.id]);
        return true;
      });
      if (!has) {
        throw toApiError(
          new AppError('VALIDATION_FAILED', { reason: 'profession_required' }),
          'UNPROCESSABLE_ENTITY',
        );
      }
    },
    afterAcceptInvitation: async (data: {
      invitation: { id: string; organizationId: string; role: string; inviterId: string };
      member: { id: string };
      user: { id: string };
    }) => {
      const now = deps.now();
      const inviter = await deps.store.user(data.invitation.inviterId);
      const invitee = await deps.store.user(data.user.id);
      // Davet eden `verified` ise davetle gelen kullanıcı doğrulanır (042 §4.2 adım 4): meslek
      // rolünde profil kaynağı `org_invitation` olmalıdır; diğer rollerde meslek doğrulaması yoktur
      //. Sonradan admin incelemesi `org_invitation AND reviewed_at IS NULL` kuyruğundadır.
      if (
        inviter?.verificationStatus === 'verified' &&
        invitee?.verificationStatus === 'pending_verification'
      ) {
        let eligible = true;
        if (isProfessionRole(data.invitation.role)) {
          eligible = await deps.appDb.withUserScope({ userId: data.user.id }, async (tx) => {
            const r = await tx.query<{ source: string | null }>(
              'SELECT verification_source AS source FROM app.lawyer_profiles WHERE user_id = $1',
              [data.user.id],
            );
            return r.rows[0]?.source === 'org_invitation';
          });
        }
        if (eligible) await deps.store.markVerifiedByInvitation(data.user.id, now);
      }
      await deps.audit({
        action: 'org.member.joined',
        userId: data.user.id,
        orgId: data.invitation.organizationId,
        targetType: 'member',
        targetId: data.member.id,
        metadata: {
          memberId: data.member.id,
          invitationRef: invitationRef(data.invitation.id),
          role: data.invitation.role,
        },
      });
    },
  };
}
