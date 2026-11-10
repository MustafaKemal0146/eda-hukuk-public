// Yönetim yüzeyi (`:8010`) "Kullanıcılar ve kullanıcı limitleri" sözleşmeleri (053-ekranlar/11 §3.4).
// Yanıtlar içeriksizdir: kimlik, e-posta (takma ad `userEmail`), durum ve sayaç; sohbet metni, belge ve
// dosya adı yoktur. Limit alanlarında `null` = varsayılan zincir (config/defaults) geçerlidir.
import { z } from 'zod';
import { PLATFORM_ROLES, USER_SUSPEND_REASONS, VERIFICATION_STATUSES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const USER_ACCOUNT_STATUSES = ['active', 'suspended'] as const;
export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

/** Liste ve ayrıntı sınırları: tamsayı sütunları ve bigint güvenli üst sınır. */
export const USER_LIMIT_MAX_TURNS = 1_000_000;
export const USER_LIMIT_MAX_TOKENS = 100_000_000_000;

export const AdminUserListItemDto = z.strictObject({
  userId: z.uuid(),
  /** Kimliğin son 8 hanesi (listede kısa kimlik). */
  shortId: z.string().regex(/^[0-9a-f]{8}$/),
  userEmail: z.string(),
  platformRole: z.enum(PLATFORM_ROLES),
  emailVerified: z.boolean(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  accountStatus: z.enum(USER_ACCOUNT_STATUSES),
  orgCount: z.number().int().min(0),
  lastLoginAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type AdminUserListItemDtoValue = z.infer<typeof AdminUserListItemDto>;

const FilterFields = {
  accountStatus: z.enum(USER_ACCOUNT_STATUSES).optional(),
  platformRole: z.enum(PLATFORM_ROLES).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

/** `GET /admin/users`: yalnız süzgeç (arama metni URL'de taşınmaz; `POST /users/search` kullanılır). */
export const AdminUserListQuery = z.strictObject(FilterFields);
export type AdminUserListQueryValue = z.infer<typeof AdminUserListQuery>;

/** `POST /admin/users/search`: e-posta öneki, tam kimlik veya kısa kimlik (son 8 hane) gövdede gider. */
export const AdminUserSearchInput = z.strictObject({
  query: z.string().trim().min(2).max(254).optional(),
  ...FilterFields,
  limit: z.number().int().min(1).max(100).optional(),
});
export type AdminUserSearchInputValue = z.infer<typeof AdminUserSearchInput>;

export const AdminUserListResponse = z.strictObject({
  items: z.array(AdminUserListItemDto),
  nextCursor: z.string().nullable(),
});
export type AdminUserListResponseValue = z.infer<typeof AdminUserListResponse>;

const LimitValues = z.strictObject({
  chatTurnsPerDay: z.number().int().nullable(),
  chatTurnsPerMonth: z.number().int().nullable(),
  tokensPerDay: z.number().int().nullable(),
  tokensPerMonth: z.number().int().nullable(),
});

export const AdminUserDetailDto = z.strictObject({
  user: AdminUserListItemDto,
  account: z.strictObject({
    status: z.enum(USER_ACCOUNT_STATUSES),
    suspendReasonCode: z.enum(USER_SUSPEND_REASONS).nullable(),
  }),
  security: z.strictObject({
    passkeyCount: z.number().int().min(0),
    totpEnabled: z.boolean(),
    activeSessions: z.number().int().min(0),
  }),
  usage: z.strictObject({
    conversationsTotal: z.number().int().min(0),
    chatTurnsToday: z.number().int().min(0),
    chatTurnsMonth: z.number().int().min(0),
    tokensToday: z.number().int().min(0),
    tokensMonth: z.number().int().min(0),
  }),
  limits: z.strictObject({
    /** Kullanıcıya özel değerler (`null` = geçersiz kılma yok). */
    overrides: LimitValues,
    /** Varsayılan zincir (`null` = sınırsız). */
    defaults: LimitValues,
    /** Geçerli değer = geçersiz kılma ?? varsayılan (`null` = sınırsız). */
    effective: LimitValues,
    overriddenAt: IsoDateTime.nullable(),
  }),
});
export type AdminUserDetailDtoValue = z.infer<typeof AdminUserDetailDto>;

export const AdminUserSuspendInput = z.strictObject({
  suspended: z.boolean(),
  reasonCode: z.enum(USER_SUSPEND_REASONS).optional(),
});
export type AdminUserSuspendInputValue = z.infer<typeof AdminUserSuspendInput>;

export const AdminUserSuspendResult = z.strictObject({
  userId: z.uuid(),
  accountStatus: z.enum(USER_ACCOUNT_STATUSES),
  changed: z.boolean(),
  revokedSessions: z.number().int().min(0),
});

export const AdminUserSessionsRevokeResult = z.strictObject({
  userId: z.uuid(),
  revokedSessions: z.number().int().min(0),
});

/** `null` = bu alan için varsayılan zinciri kullan; dört alan da `null` ise geçersiz kılma silinir. */
export const AdminUserLimitsInput = z.strictObject({
  chatTurnsPerDay: z.number().int().min(0).max(USER_LIMIT_MAX_TURNS).nullable(),
  chatTurnsPerMonth: z.number().int().min(0).max(USER_LIMIT_MAX_TURNS).nullable(),
  tokensPerDay: z.number().int().min(0).max(USER_LIMIT_MAX_TOKENS).nullable(),
  tokensPerMonth: z.number().int().min(0).max(USER_LIMIT_MAX_TOKENS).nullable(),
});
export type AdminUserLimitsInputValue = z.infer<typeof AdminUserLimitsInput>;
