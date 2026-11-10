// Büro, davet ve MFA kimlik tablosu erişimi (042 §4, §5; P04b): yalnız `authDb` (`eda_auth`) ile ve
// yalnız bu dizinde (Y-98). Servisler ve ara katmanlar `OrgStore` arayüzünü görür. Davet kimliği
// taşıyıcı belirteçtir: dışarıya yalnız `invitationRef()` özeti verilir; kimlik bu modülde ve
// e-posta mühründe kalır. E-posta karşılaştırmaları `normalizeEmail` çıktısıyla (ASCII küçük harf).
import { createHash } from 'node:crypto';
import { INVITATION_REF_LENGTH } from '@eda/contracts/api/org';
import type { InvitationStatus, MemberRole, MemberStatus, OrgKind } from '@eda/contracts/enums';
import { and, asc, count, eq, gt, lte, ne } from 'drizzle-orm';
import { AUTH_TABLES, type AuthDb } from './auth-db.ts';

const { users, organizations, members, invitations, twoFactors, passkeys, sessions } = AUTH_TABLES;

/** `sha256(davet kimliği)` ilk 12 onaltılık karakter (042 §13 `invitationRef`). */
export function invitationRef(invitationId: string): string {
  return createHash('sha256')
    .update(invitationId, 'utf8')
    .digest('hex')
    .slice(0, INVITATION_REF_LENGTH);
}

export interface InvitationRow {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: Exclude<MemberRole, 'owner'>;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly inviterId: string;
  readonly createdAt: Date;
}

export interface MemberRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: MemberRole;
  readonly status: MemberStatus;
}

export interface OrgState {
  readonly id: string;
  readonly kind: OrgKind;
  readonly suspendedAt: Date | null;
  readonly closedAt: Date | null;
}

export interface UserAuthState {
  readonly id: string;
  readonly email: string;
  readonly platformRole: string;
  readonly verificationStatus: string;
  readonly twoFactorEnabled: boolean;
}

export interface MfaFactors {
  readonly totp: boolean;
  readonly passkeys: number;
}

const invitationCols = {
  id: invitations.id,
  organizationId: invitations.organizationId,
  email: invitations.email,
  role: invitations.role,
  status: invitations.status,
  expiresAt: invitations.expiresAt,
  inviterId: invitations.inviterId,
  createdAt: invitations.createdAt,
};

const asInvitation = (r: {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviterId: string;
  createdAt: Date;
}): InvitationRow => ({
  ...r,
  role: r.role as InvitationRow['role'],
  status: r.status as InvitationStatus,
});

export function createOrgStore(db: AuthDb) {
  return {
    async user(userId: string): Promise<UserAuthState | null> {
      const [u] = await db
        .select({
          id: users.id,
          email: users.email,
          platformRole: users.platformRole,
          verificationStatus: users.verificationStatus,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, userId));
      return u ?? null;
    },

    async org(orgId: string): Promise<OrgState | null> {
      const [o] = await db
        .select({
          id: organizations.id,
          kind: organizations.kind,
          suspendedAt: organizations.suspendedAt,
          closedAt: organizations.closedAt,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      return o === undefined ? null : { ...o, kind: o.kind as OrgKind };
    },

    async invitationById(id: string): Promise<InvitationRow | null> {
      const [r] = await db.select(invitationCols).from(invitations).where(eq(invitations.id, id));
      return r === undefined ? null : asInvitation(r);
    },

    /** Süresi dolmamış bekleyen davetler (eskiden yeniye). */
    async pendingInvitations(orgId: string, now: Date): Promise<InvitationRow[]> {
      const rows = await db
        .select(invitationCols)
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, orgId),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, now),
          ),
        )
        .orderBy(asc(invitations.createdAt));
      return rows.map(asInvitation);
    },

    /** Kullanıcının adresine gelmiş süresi dolmamış bekleyen davet var mı (bireysel büro açılmaz). */
    async hasPendingInvitationFor(email: string, now: Date): Promise<boolean> {
      const [r] = await db
        .select({ n: count() })
        .from(invitations)
        .where(
          and(
            eq(invitations.email, email),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, now),
          ),
        );
      return (r?.n ?? 0) > 0;
    },

    /** Süresi dolmuş bekleyen davetleri iptal eder (kısmi benzersiz indeks yeni daveti engellemesin). */
    async cancelExpiredPending(orgId: string, email: string, now: Date): Promise<void> {
      await db
        .update(invitations)
        .set({ status: 'canceled' })
        .where(
          and(
            eq(invitations.organizationId, orgId),
            eq(invitations.email, email),
            eq(invitations.status, 'pending'),
            lte(invitations.expiresAt, now),
          ),
        );
    },

    async insertInvitation(input: {
      readonly orgId: string;
      readonly email: string;
      readonly role: InvitationRow['role'];
      readonly inviterId: string;
      readonly expiresAt: Date;
    }): Promise<InvitationRow> {
      const [r] = await db
        .insert(invitations)
        .values({
          organizationId: input.orgId,
          email: input.email,
          role: input.role,
          status: 'pending',
          expiresAt: input.expiresAt,
          inviterId: input.inviterId,
        })
        .returning(invitationCols);
      if (r === undefined) throw new Error('davet oluşturulamadı');
      return asInvitation(r);
    },

    /** Yalnız bekleyen davetin durumunu değiştirir; değiştiyse true. */
    async setInvitationStatus(
      id: string,
      status: Exclude<InvitationStatus, 'pending'>,
    ): Promise<boolean> {
      const r = await db
        .update(invitations)
        .set({ status })
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
        .returning({ id: invitations.id });
      return r.length > 0;
    },

    async member(orgId: string, memberId: string): Promise<MemberRow | null> {
      const [m] = await db
        .select({
          id: members.id,
          organizationId: members.organizationId,
          userId: members.userId,
          role: members.role,
          status: members.status,
        })
        .from(members)
        .where(and(eq(members.organizationId, orgId), eq(members.id, memberId)));
      return m === undefined
        ? null
        : { ...m, role: m.role as MemberRole, status: m.status as MemberStatus };
    },

    async memberByUser(orgId: string, userId: string): Promise<MemberRow | null> {
      const [m] = await db
        .select({
          id: members.id,
          organizationId: members.organizationId,
          userId: members.userId,
          role: members.role,
          status: members.status,
        })
        .from(members)
        .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)));
      return m === undefined
        ? null
        : { ...m, role: m.role as MemberRole, status: m.status as MemberStatus };
    },

    /** Bu adrese sahip kullanıcı büroda üye mi (etkin veya askıda). */
    async isMemberEmail(orgId: string, email: string): Promise<boolean> {
      const [r] = await db
        .select({ n: count() })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.organizationId, orgId), eq(users.email, email)));
      return (r?.n ?? 0) > 0;
    },

    /** Etkin `owner` sayısı (verilen üye hariç). */
    async activeOwnersExcept(orgId: string, memberId: string): Promise<number> {
      const [r] = await db
        .select({ n: count() })
        .from(members)
        .where(
          and(
            eq(members.organizationId, orgId),
            eq(members.role, 'owner'),
            eq(members.status, 'active'),
            ne(members.id, memberId),
          ),
        );
      return r?.n ?? 0;
    },

    async updateMember(
      memberId: string,
      patch: { readonly role?: MemberRole; readonly status?: MemberStatus },
      now: Date,
    ): Promise<void> {
      await db
        .update(members)
        .set({ ...patch, updatedAt: now })
        .where(eq(members.id, memberId));
    },

    async deleteMember(memberId: string): Promise<void> {
      await db.delete(members).where(eq(members.id, memberId));
    },

    /** Kullanıcının bu büroyu aktif gösteren oturum belirteçleri (askı/çıkarma sonrası temizlik). */
    async sessionTokensWithActiveOrg(userId: string, orgId: string): Promise<string[]> {
      const rows = await db
        .select({ token: sessions.token })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.activeOrganizationId, orgId)));
      return rows.map((r) => r.token);
    },

    /** Etkin üyelikler büro türüyle (MFA kaldırma kuralı, 042 §5.5). */
    async activeMembershipsWithKind(
      userId: string,
    ): Promise<{ orgId: string; role: MemberRole; kind: OrgKind }[]> {
      const rows = await db
        .select({ orgId: members.organizationId, role: members.role, kind: organizations.kind })
        .from(members)
        .innerJoin(organizations, eq(organizations.id, members.organizationId))
        .where(and(eq(members.userId, userId), eq(members.status, 'active')));
      return rows.map((r) => ({ ...r, role: r.role as MemberRole, kind: r.kind as OrgKind }));
    },

    async mfaFactors(userId: string): Promise<MfaFactors> {
      const [tf] = await db
        .select({ verified: twoFactors.verified })
        .from(twoFactors)
        .innerJoin(users, eq(users.id, twoFactors.userId))
        .where(and(eq(twoFactors.userId, userId), eq(users.twoFactorEnabled, true)));
      const [pk] = await db
        .select({ n: count() })
        .from(passkeys)
        .where(eq(passkeys.userId, userId));
      return { totp: tf?.verified === true, passkeys: pk?.n ?? 0 };
    },

    /** Passkey kaydı (sayaç denetimi ve step-up doğrulaması). */
    async passkeyByCredential(credentialId: string) {
      const [p] = await db
        .select({
          id: passkeys.id,
          userId: passkeys.userId,
          credentialId: passkeys.credentialID,
          publicKey: passkeys.publicKey,
          counter: passkeys.counter,
          transports: passkeys.transports,
        })
        .from(passkeys)
        .where(eq(passkeys.credentialID, credentialId));
      return p ?? null;
    },

    async setPasskeyCounter(id: string, counter: number): Promise<void> {
      await db.update(passkeys).set({ counter }).where(eq(passkeys.id, id));
    },

    /** Davetle gelen kullanıcıyı doğrular (yalnız `pending_verification` iken). */
    async markVerifiedByInvitation(userId: string, now: Date): Promise<boolean> {
      const r = await db
        .update(users)
        .set({ verificationStatus: 'verified', updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.verificationStatus, 'pending_verification')))
        .returning({ id: users.id });
      return r.length > 0;
    },

    /** Parola özeti (`credential` hesabı; step-up parola doğrulaması). */
    async credentialHash(userId: string): Promise<string | null> {
      const [a] = await db
        .select({ password: AUTH_TABLES.accounts.password })
        .from(AUTH_TABLES.accounts)
        .where(
          and(
            eq(AUTH_TABLES.accounts.userId, userId),
            eq(AUTH_TABLES.accounts.providerId, 'credential'),
          ),
        );
      return a?.password ?? null;
    },
  };
}

export type OrgStore = ReturnType<typeof createOrgStore>;
