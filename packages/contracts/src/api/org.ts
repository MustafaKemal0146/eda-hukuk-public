// Büro yönetimi uçları (002 §15 "Büro"; 042 §4, §7; P04b): `GET /api/v1/org`, davetler ve üyeler.
// Davet kimliği (davet satırının birincil anahtarı) kabul bağlantısındaki taşıyıcı belirteçtir (042 Tuzak 9): hiçbir
// yanıtta dönmez. Davet yalnız `ref` ile anılır: `sha256(davetKimliği)` ilk `INVITATION_REF_LENGTH`
// onaltılık karakteri (denetim `invitationRef` ile aynı değer). `DELETE /org/invitations/:invitationId`
// yol parametresi bu `ref`'tir. Idempotent davet yanıtı yalnız kimlik + durum + enum taşır
// (040 §10).
import { z } from 'zod';
import { INVITATION_STATUSES, MEMBER_ROLES, MEMBER_STATUSES, ORG_KINDS } from '../enums.ts';
import { EmailInput } from './auth.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

/** Davetle verilebilen roller: `owner` davet edilemez (030 `invitations_role_chk`; 042 §4.1). */
export const INVITABLE_ROLES = MEMBER_ROLES.filter(
  (r): r is Exclude<(typeof MEMBER_ROLES)[number], 'owner'> => r !== 'owner',
);
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** Meslek profili gerektiren roller (042 §4.2 adım 4); `assistant` ve `admin` gerektirmez. */
export const PROFESSION_ROLES = ['senior_lawyer', 'lawyer', 'trainee'] as const;

/** `sha256(davet kimliği)` ilk onaltılık karakter sayısı (042 §13 `invitationRef`). */
export const INVITATION_REF_LENGTH = 12;
export const InvitationRef = z.string().regex(/^[0-9a-f]{12}$/);

export const SeatUsageDto = z.strictObject({
  capacity: z.number().int().min(0),
  used: z.number().int().min(0),
  pendingInvitations: z.number().int().min(0),
});
export type SeatUsageDto = z.infer<typeof SeatUsageDto>;

/** `GET /api/v1/org` (`org:read`, `mfa: exempt`). */
export const OrgDto = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(ORG_KINDS),
  role: z.enum(MEMBER_ROLES),
  seats: SeatUsageDto,
});
export type OrgDto = z.infer<typeof OrgDto>;

/** `POST /api/v1/org/invitations` gövdesi (`idempotency: required`). */
export const InvitationCreateInput = z.strictObject({
  email: EmailInput,
  role: z.enum(INVITABLE_ROLES),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateInput>;

/** Davet oluşturma yanıtı: yalnız kimlik (ref) + durum + enum (040 §10; e-posta saklanmaz). */
export const InvitationCreatedDto = z.strictObject({
  ref: InvitationRef,
  role: z.enum(INVITABLE_ROLES),
  status: z.literal('pending'),
  expiresAt: IsoDateTime,
});
export type InvitationCreatedDto = z.infer<typeof InvitationCreatedDto>;

export const InvitationDto = z.strictObject({
  ref: InvitationRef,
  email: z.string(),
  role: z.enum(INVITABLE_ROLES),
  status: z.enum(INVITATION_STATUSES),
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type InvitationDto = z.infer<typeof InvitationDto>;

/** `GET /api/v1/org/invitations`: süresi dolmamış bekleyen davetler. */
export const InvitationListDto = z.strictObject({ items: z.array(InvitationDto) });
export type InvitationListDto = z.infer<typeof InvitationListDto>;

export const InvitationCanceledDto = z.strictObject({
  ref: InvitationRef,
  status: z.literal('canceled'),
});
export type InvitationCanceledDto = z.infer<typeof InvitationCanceledDto>;

export const MemberDto = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
  joinedAt: IsoDateTime,
});
export type MemberDto = z.infer<typeof MemberDto>;

export const MemberListDto = z.strictObject({ items: z.array(MemberDto) });
export type MemberListDto = z.infer<typeof MemberListDto>;

/**
 * `PATCH /api/v1/org/members/:memberId` (`org:member_manage`, step-up): rol ve/veya durum. `owner`
 * rolü `PATCH` ile atanamaz (sahiplik aktarımı ayrı akıştır; 042 §4.4).
 */
export const MemberPatchInput = z
  .strictObject({
    role: z.enum(INVITABLE_ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    path: ['role'],
    message: 'required',
  });
export type MemberPatchInput = z.infer<typeof MemberPatchInput>;

export const MemberRemovedDto = z.strictObject({
  id: z.uuid(),
  status: z.literal('removed'),
});
export type MemberRemovedDto = z.infer<typeof MemberRemovedDto>;
