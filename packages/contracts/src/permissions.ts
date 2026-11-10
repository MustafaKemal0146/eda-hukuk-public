// İzin modeli (042 §8): izin adları, rol eşlemesi (`PERMISSIONS`) ve tek karar noktası `can()`.
// Saf ve eşzamanlıdır; DB, Hono veya istek bağlamı bilmez. Rol bilgisi istemciden alınmaz; çağıran
// (api `authorize` ara katmanı) rolü her istekte üyelik tablosundan okur (042 ilke 3). §8.2 ve §8.4
// matrisleri `fixtures/permission-matrix.json` anlık görüntüsüyle birebir eşittir (KK-042-14); matris
// değişikliği CODEOWNERS iki onayına tabidir.
import { MEMBER_ROLES, type MemberRole, type PLATFORM_ROLES } from './enums.ts';

export { MEMBER_ROLES, type MemberRole };

/** Platform personeli rolleri (yalnız admin yüzeyi; `user` izin taşımaz). */
export const STAFF_ROLES = [
  'support',
  'super_admin',
] as const satisfies readonly (typeof PLATFORM_ROLES)[number][];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Büro izinleri (042 §8.1; sıra §8.2 matrisinin satır sırasıdır). */
export const ORG_PERMISSIONS = [
  'research:use',
  'chat:use',
  'chat:supervise',
  'conversation:export',
  'client:read',
  'client:write',
  'client:delete',
  'case:read',
  'case:write',
  'case:team',
  'case:policy',
  'file:read',
  'file:upload',
  'file:delete',
  'file:bulk_download',
  'document:read',
  'document:write',
  'document:export',
  'document:approve',
  'template:manage',
  'prompt:manage_org',
  'calendar:read',
  'calendar:write',
  'case_ai_log:read',
  'case_ai_log:export',
  'org:read',
  'org:settings_write',
  'org:ai_policy_write',
  'org:public_mode_enable',
  'org:member_read',
  'org:member_invite',
  'org:member_manage',
  'org:ownership_transfer',
  'org:audit_read',
  'org:usage_read',
  'org:billing_read',
  'org:billing_manage',
  'org:data_subject_search',
  'org:delete',
  'poa:write',
  'file:write',
  'document:delete',
  'citation:attest',
  'deadline:approve',
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

/** Platform izinleri (042 §8.1 sonu, §8.4; yalnız admin yüzeyi). */
export const PLATFORM_PERMISSIONS = [
  'platform:application_review',
  'platform:org_suspend',
  'platform:user_suspend',
  'platform:session_revoke',
  'platform:audit_read',
  'platform:ai_catalog_read',
  'platform:ai_catalog_write',
  'platform:sources_read',
  'platform:usage_read',
  'platform:system_settings_read',
  'platform:system_settings_write',
  'platform:flags_write',
  'platform:maintenance',
  'platform:coupon_manage',
  'platform:payout_report',
  'platform:recovery_approve',
  'platform:billing_read',
  'platform:billing_write',
  'platform:break_glass',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export type Permission = OrgPermission | PlatformPermission;

/** Rota meta özel değerleri (040 §4): `public` yalnız 040 §5.9 listesi, `self` yalnız oturum. */
export const ROUTE_PERMISSION_SPECIALS = ['public', 'self'] as const;
export type RoutePermission = Permission | (typeof ROUTE_PERMISSION_SPECIALS)[number];

/**
 * Koşullu kurallar (042 §8.3): a = asistan sohbeti büro ayarına bağlı, b = denetim büro ayarına bağlı,
 * c = yönetici yalnız owner/admin dışı rollerde işlem yapar, d = stajyer dışa aktarımı onay ayarına bağlı.
 */
export const PERMISSION_CONDITIONS = ['a', 'b', 'c', 'd'] as const;
export type PermissionCondition = (typeof PERMISSION_CONDITIONS)[number];

export type OrgPermissionRule = {
  readonly scope: 'org';
  /** Koşulsuz izinli roller. */
  readonly roles: readonly MemberRole[];
  /** Koşula bağlı izinli roller (§8.2 hücresindeki harf). */
  readonly conditional?: Partial<Readonly<Record<MemberRole, PermissionCondition>>>;
  /** Son `auth.stepUpWindowMin` içinde yeniden doğrulama (042 §6.2). */
  readonly stepUp: boolean;
};
export type PlatformPermissionRule = {
  readonly scope: 'platform';
  readonly roles: readonly StaffRole[];
  readonly stepUp: boolean;
};

const ALL: readonly MemberRole[] = MEMBER_ROLES;
const NO_ASSISTANT: readonly MemberRole[] = [
  'owner',
  'admin',
  'senior_lawyer',
  'lawyer',
  'trainee',
];
const LAWYERS: readonly MemberRole[] = ['owner', 'admin', 'senior_lawyer', 'lawyer'];
const SENIORS: readonly MemberRole[] = ['owner', 'admin', 'senior_lawyer'];
const MANAGERS: readonly MemberRole[] = ['owner', 'admin'];
const OWNER: readonly MemberRole[] = ['owner'];

const org = (
  roles: readonly MemberRole[],
  stepUp = false,
  conditional?: OrgPermissionRule['conditional'],
): OrgPermissionRule => ({
  scope: 'org',
  roles,
  stepUp,
  ...(conditional === undefined ? {} : { conditional }),
});
const platform = (roles: readonly StaffRole[], stepUp = false): PlatformPermissionRule => ({
  scope: 'platform',
  roles,
  stepUp,
});
const SUPER: readonly StaffRole[] = ['super_admin'];
const STAFF: readonly StaffRole[] = ['support', 'super_admin'];

/** 042 §8.2 (büro) ve §8.4 (platform) matrisleri; step-up sütunu §8.1 ve §6.2. */
export const PERMISSIONS = {
  'research:use': org(NO_ASSISTANT),
  'chat:use': org(NO_ASSISTANT, false, { assistant: 'a' }),
  'chat:supervise': org(MANAGERS, false, { senior_lawyer: 'b' }),
  'conversation:export': org(NO_ASSISTANT, true, { assistant: 'a' }),
  'client:read': org(ALL),
  'client:write': org(NO_ASSISTANT),
  'client:delete': org(MANAGERS),
  'case:read': org(ALL),
  'case:write': org(NO_ASSISTANT),
  'case:team': org(LAWYERS),
  'case:policy': org(LAWYERS, true),
  'file:read': org(ALL),
  'file:upload': org(ALL),
  'file:delete': org(LAWYERS),
  'file:bulk_download': org(SENIORS, true),
  'document:read': org(NO_ASSISTANT),
  'document:write': org(NO_ASSISTANT),
  'document:export': org(LAWYERS, true, { trainee: 'd' }),
  'document:approve': org(SENIORS),
  'template:manage': org(SENIORS),
  'prompt:manage_org': org(SENIORS),
  'calendar:read': org(ALL),
  'calendar:write': org(ALL),
  'case_ai_log:read': org(LAWYERS),
  'case_ai_log:export': org(LAWYERS, true),
  'org:read': org(ALL),
  'org:settings_write': org(MANAGERS),
  'org:ai_policy_write': org(MANAGERS, true),
  'org:public_mode_enable': org(OWNER, true),
  'org:member_read': org(NO_ASSISTANT),
  'org:member_invite': org(OWNER, false, { admin: 'c' }),
  'org:member_manage': org(OWNER, true, { admin: 'c' }),
  'org:ownership_transfer': org(OWNER, true),
  'org:audit_read': org(MANAGERS),
  'org:usage_read': org(MANAGERS),
  'org:billing_read': org(MANAGERS),
  'org:billing_manage': org(OWNER, true),
  'org:data_subject_search': org(OWNER, true),
  'org:delete': org(OWNER, true),
  'poa:write': org(LAWYERS),
  'file:write': org(NO_ASSISTANT),
  'document:delete': org(LAWYERS),
  'citation:attest': org(LAWYERS, true),
  'deadline:approve': org(LAWYERS),
  'platform:application_review': platform(SUPER, true),
  'platform:org_suspend': platform(STAFF, true),
  'platform:user_suspend': platform(STAFF, true),
  'platform:session_revoke': platform(STAFF),
  'platform:audit_read': platform(STAFF),
  'platform:ai_catalog_read': platform(SUPER),
  'platform:ai_catalog_write': platform(SUPER, true),
  'platform:sources_read': platform(SUPER),
  'platform:usage_read': platform(SUPER),
  'platform:system_settings_read': platform(SUPER),
  'platform:system_settings_write': platform(SUPER, true),
  'platform:flags_write': platform(SUPER, true),
  'platform:maintenance': platform(SUPER, true),
  'platform:coupon_manage': platform(SUPER, true),
  'platform:payout_report': platform(SUPER),
  'platform:recovery_approve': platform(SUPER, true),
  'platform:billing_read': platform(SUPER),
  'platform:billing_write': platform(SUPER, true),
  'platform:break_glass': platform(SUPER, true),
} as const satisfies Record<OrgPermission, OrgPermissionRule> &
  Record<PlatformPermission, PlatformPermissionRule>;

export function isPermission(name: string): name is Permission {
  return Object.hasOwn(PERMISSIONS, name);
}

/** Rota meta değeri izin kaydında veya `public`/`self` özel değerlerinde mi (route census). */
export function isRoutePermission(name: string): name is RoutePermission {
  return (ROUTE_PERMISSION_SPECIALS as readonly string[]).includes(name) || isPermission(name);
}

/** Koşullu kuralların okuduğu büro ayarı alt kümesi (042 §8.5; Açık Soru 3). */
export type PermissionSettings = {
  readonly assistantAiChatEnabled: boolean;
  readonly traineeExportRequiresApproval: boolean;
  readonly traineeSupervision: boolean;
};

export type Subject =
  | {
      readonly surface: 'app';
      readonly memberRole: MemberRole;
      readonly settings?: PermissionSettings;
    }
  | { readonly surface: 'admin'; readonly platformRole: StaffRole };

export type DenyCode = 'ORG_ROLE_INSUFFICIENT' | 'AUTH_FORBIDDEN' | 'AI_POLICY_ROLE_DISABLED';
export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly code: DenyCode; readonly reason?: string };

export type CanContext = {
  /** Koşul c: işlem yapılan üyenin rolü (rol atamada atanan rol). */
  readonly targetRole?: MemberRole;
  /** Koşul c: işlem yapılan üye büro sahibi mi. */
  readonly targetIsOwner?: boolean;
};

const ALLOW: Decision = { allow: true };
const INSUFFICIENT: Decision = { allow: false, code: 'ORG_ROLE_INSUFFICIENT' };

/** Koşulun büro ayarı gerektirip gerektirmediği (tenant ara katmanı ayarları yalnız gerekirse okur). */
export function requiresSettings(permission: Permission, role: MemberRole): boolean {
  const rule: OrgPermissionRule | PlatformPermissionRule = PERMISSIONS[permission];
  if (rule.scope !== 'org') return false;
  const cond = rule.conditional?.[role];
  return cond === 'a' || cond === 'b' || cond === 'd';
}

function checkCondition(
  cond: PermissionCondition,
  settings: PermissionSettings | undefined,
  ctx: CanContext | undefined,
): Decision {
  switch (cond) {
    case 'a':
      // Ayar okunamadıysa izin verilmez (fail-closed).
      return settings?.assistantAiChatEnabled === true
        ? ALLOW
        : { allow: false, code: 'AI_POLICY_ROLE_DISABLED' };
    case 'b':
      return settings?.traineeSupervision === true
        ? ALLOW
        : { allow: false, code: 'AUTH_FORBIDDEN', reason: 'supervision_disabled' };
    case 'c':
      // Yönetici owner/admin üzerinde işlem yapamaz ve bu rolleri atayamaz (§4.4); hedef bilinmiyorsa
      // yalnız uç erişimi (liste/form) için izin verilir, işlem anında hedefle yeniden sorulur.
      if (ctx?.targetIsOwner === true) return INSUFFICIENT;
      if (ctx?.targetRole === 'owner' || ctx?.targetRole === 'admin') return INSUFFICIENT;
      return ALLOW;
    case 'd':
      return settings?.traineeExportRequiresApproval === false
        ? ALLOW
        : { allow: false, code: 'AUTH_FORBIDDEN', reason: 'approval_required' };
  }
}

/**
 * Tek karar noktası (042 §8.5). Yetersiz rol -> `ORG_ROLE_INSUFFICIENT`; koşul -> ilgili kod +
 * `reason`. Uygulama yüzeyinde platform izni, admin yüzeyinde büro izni her zaman reddedilir
 * (`AUTH_FORBIDDEN`). Kaynak düzeyi erişim burada değil RLS'de çözülür.
 */
export function can(subject: Subject, permission: Permission, ctx?: CanContext): Decision {
  const rule: OrgPermissionRule | PlatformPermissionRule = PERMISSIONS[permission];
  if (subject.surface === 'admin') {
    if (rule.scope !== 'platform') return { allow: false, code: 'AUTH_FORBIDDEN' };
    return rule.roles.includes(subject.platformRole) ? ALLOW : INSUFFICIENT;
  }
  if (rule.scope !== 'org') return { allow: false, code: 'AUTH_FORBIDDEN' };
  if (rule.roles.includes(subject.memberRole)) {
    // c koşulu yalnız admin hücresindedir; owner koşulsuzdur.
    return ALLOW;
  }
  const cond = rule.conditional?.[subject.memberRole];
  if (cond === undefined) return INSUFFICIENT;
  return checkCondition(cond, subject.settings, ctx);
}

/** §8.2 ve §8.4 matrislerinin hücre gösterimi (anlık görüntü testi; `E`, `-` veya koşul harfi). */
export function permissionMatrix(): {
  readonly org: Readonly<Record<OrgPermission, Readonly<Record<MemberRole, string>>>>;
  readonly platform: Readonly<Record<PlatformPermission, Readonly<Record<StaffRole, string>>>>;
} {
  const orgOut = {} as Record<OrgPermission, Record<MemberRole, string>>;
  for (const p of ORG_PERMISSIONS) {
    const rule: OrgPermissionRule = PERMISSIONS[p];
    const row = {} as Record<MemberRole, string>;
    for (const r of MEMBER_ROLES) {
      const cond = rule.conditional?.[r];
      row[r] = rule.roles.includes(r) ? 'E' : (cond ?? '-');
    }
    orgOut[p] = row;
  }
  const platOut = {} as Record<PlatformPermission, Record<StaffRole, string>>;
  for (const p of PLATFORM_PERMISSIONS) {
    const rule: PlatformPermissionRule = PERMISSIONS[p];
    platOut[p] = {
      support: rule.roles.includes('support') ? 'E' : '-',
      super_admin: rule.roles.includes('super_admin') ? 'E' : '-',
    };
  }
  return { org: orgOut, platform: platOut };
}
