// `auth` şemasından salt-okur erişim (031 §3 kalan risk telafisi). auth RLS'sizdir; eda_app'in kolon
// yetkisi tüm büroları kapsar. Bu yüzden auth okumaları YALNIZ bu dosyadaki fonksiyonlarla yapılır ve
// her sorgu SQL içinde `organization_id = app.current_org_id()` veya `user_id = app.current_user_id()`
// koşulunu taşır (kiracı bağı yoksa 0 satır). check-tenant-binding.sh (auth-access) başka dosyada auth
// tablo başvurusunu reddeder. Fonksiyonlar `withTenant`/`withUserScope` işlemi içinde çağrılır.
import type { MemberRole } from '@eda/contracts/enums';
import type { TenantTx, UserTx } from './tenant.ts';

export interface ActiveMembership {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MemberRole;
}

export interface UserMembership {
  readonly organizationId: string;
  readonly role: MemberRole;
  readonly status: 'active' | 'suspended';
  readonly createdAt: Date;
}

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: 'individual' | 'firm';
  readonly partnerCode: string | null;
  readonly createdAt: Date;
}

/** Mevcut büroda kullanıcının etkin üyeliği (yoksa null). */
export async function findActiveMembership(
  tx: TenantTx,
  userId: string,
  orgId: string,
): Promise<ActiveMembership | null> {
  const r = await tx.query<{ organization_id: string; user_id: string; role: MemberRole }>(
    `SELECT organization_id, user_id, role FROM auth.members
     WHERE organization_id = app.current_org_id() AND organization_id = $2
       AND user_id = $1 AND status = 'active'`,
    [userId, orgId],
  );
  const row = r.rows[0];
  return row === undefined
    ? null
    : { organizationId: row.organization_id, userId: row.user_id, role: row.role };
}

/** Oturumdaki kullanıcının üyelikleri (yalnız kendisi; başka kullanıcı için boş). */
export async function listMembershipsOfUser(
  tx: TenantTx | UserTx,
  userId: string,
): Promise<UserMembership[]> {
  const r = await tx.query<{
    organization_id: string;
    role: MemberRole;
    status: 'active' | 'suspended';
    created_at: Date;
  }>(
    `SELECT organization_id, role, status, created_at FROM auth.members
     WHERE user_id = app.current_user_id() AND user_id = $1
     ORDER BY created_at, organization_id`,
    [userId],
  );
  return r.rows.map((m) => ({
    organizationId: m.organization_id,
    role: m.role,
    status: m.status,
    createdAt: m.created_at,
  }));
}

/** Mevcut büronun özeti (başka büro kimliği için null). */
export async function getOrganizationSummary(
  tx: TenantTx,
  orgId: string,
): Promise<OrganizationSummary | null> {
  const r = await tx.query<{
    id: string;
    name: string;
    slug: string;
    kind: 'individual' | 'firm';
    partner_code: string | null;
    created_at: Date;
  }>(
    `SELECT id, name, slug, kind, partner_code, created_at FROM auth.organizations
     WHERE id = app.current_org_id() AND id = $1`,
    [orgId],
  );
  const o = r.rows[0];
  return o === undefined
    ? null
    : {
        id: o.id,
        name: o.name,
        slug: o.slug,
        kind: o.kind,
        partnerCode: o.partner_code,
        createdAt: o.created_at,
      };
}

export interface SelfUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly platformRole: 'user' | 'support' | 'super_admin';
  readonly verificationStatus: 'pending_verification' | 'verified' | 'rejected' | 'suspended';
}

/** Oturumdaki kullanıcının kendi kimlik satırı (`GET /me`; başka kullanıcı için null). */
export async function getSelfUser(tx: TenantTx | UserTx, userId: string): Promise<SelfUser | null> {
  const r = await tx.query<{
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    platform_role: SelfUser['platformRole'];
    verification_status: SelfUser['verificationStatus'];
  }>(
    `SELECT id, name, email, email_verified, platform_role, verification_status FROM auth.users
     WHERE id = app.current_user_id() AND id = $1`,
    [userId],
  );
  const u = r.rows[0];
  return u === undefined
    ? null
    : {
        id: u.id,
        name: u.name,
        email: u.email,
        emailVerified: u.email_verified,
        platformRole: u.platform_role,
        verificationStatus: u.verification_status,
      };
}

export interface MembershipDetail extends UserMembership {
  readonly orgName: string;
  readonly orgKind: 'individual' | 'firm';
}

/** Oturumdaki kullanıcının üyelikleri büro adı ve türüyle (yalnız kendisi). */
export async function listMembershipDetailsOfUser(
  tx: TenantTx | UserTx,
  userId: string,
): Promise<MembershipDetail[]> {
  const r = await tx.query<{
    organization_id: string;
    role: MemberRole;
    status: 'active' | 'suspended';
    created_at: Date;
    name: string;
    kind: 'individual' | 'firm';
  }>(
    `SELECT m.organization_id, m.role, m.status, m.created_at, o.name, o.kind
     FROM auth.members m JOIN auth.organizations o ON o.id = m.organization_id
     WHERE m.user_id = app.current_user_id() AND m.user_id = $1
     ORDER BY m.created_at, m.organization_id`,
    [userId],
  );
  return r.rows.map((m) => ({
    organizationId: m.organization_id,
    role: m.role,
    status: m.status,
    createdAt: m.created_at,
    orgName: m.name,
    orgKind: m.kind,
  }));
}

export interface EmailRecipient {
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly banned: boolean;
}

/**
 * E-posta alıcısı (045 §6.5 adım 2): yalnız `eda_worker` (kolon kısıtlı `email, name,
 * email_verified, banned`; 0018) ve alıcı bağlamında (`withUserScope`).
 */
export async function getEmailRecipient(
  tx: UserTx,
  userId: string,
): Promise<EmailRecipient | null> {
  const r = await tx.query<{
    email: string;
    name: string;
    email_verified: boolean;
    banned: boolean;
  }>(
    `SELECT email, name, email_verified, banned FROM auth.users
     WHERE id = app.current_user_id() AND id = $1`,
    [userId],
  );
  const u = r.rows[0];
  return u === undefined
    ? null
    : { email: u.email, name: u.name, emailVerified: u.email_verified, banned: u.banned };
}

export interface InvitationRecipient {
  readonly email: string;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  readonly expiresAt: Date;
}

/**
 * Davet e-postasının alıcısı (045 §6.5 adım 2; P04b): yalnız `eda_worker` ve davet edenin
 * bağlamında (`withUserScope`; teslimat satırının `user_id` değeri davet edendir). Davet kimliği
 * yalnız eşitlik koşuludur; döndürülmez.
 */
export async function getInvitationRecipient(
  tx: UserTx,
  invitationId: string,
): Promise<InvitationRecipient | null> {
  const r = await tx.query<{
    email: string;
    status: InvitationRecipient['status'];
    expires_at: Date;
  }>(
    `SELECT email, status, expires_at FROM auth.invitations
     WHERE inviter_id = app.current_user_id() AND id = $1`,
    [invitationId],
  );
  const i = r.rows[0];
  return i === undefined ? null : { email: i.email, status: i.status, expiresAt: i.expires_at };
}

export interface OrgMemberRow {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly status: 'active' | 'suspended';
  readonly createdAt: Date;
}

/** Aktif büronun üyeleri (`GET /org/members`; başka büro kimliği için boş). */
export async function listOrgMembers(tx: TenantTx, orgId: string): Promise<OrgMemberRow[]> {
  const r = await tx.query<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    role: MemberRole;
    status: 'active' | 'suspended';
    created_at: Date;
  }>(
    `SELECT m.id, m.user_id, u.name, u.email, m.role, m.status, m.created_at
     FROM auth.members m JOIN auth.users u ON u.id = m.user_id
     WHERE m.organization_id = app.current_org_id() AND m.organization_id = $1
     ORDER BY m.created_at, m.id`,
    [orgId],
  );
  return r.rows.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    createdAt: m.created_at,
  }));
}
