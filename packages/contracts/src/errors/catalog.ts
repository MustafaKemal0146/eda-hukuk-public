// Hata kodu kataloğu: 044 §6 tablolarının makine karşılığı. HTTP durumları 002 §20 ve 044 §4 ile
// aynıdır; Türkçe metinler yalnız messages.tr.ts'tedir. Yeni kod önce 044 §6'ya (ve gerekirse
// 002 §20'ye), sonra buraya ve messages.tr.ts'e eklenir.
import type { ErrorAction } from './actions.ts';
import { ERROR_MESSAGES_TR } from './messages.tr.ts';

export const ERROR_HTTP_STATUSES = [
  200, 400, 401, 402, 403, 404, 409, 410, 413, 415, 422, 423, 429, 500, 502, 503, 504,
] as const;
export type ErrorHttpStatus = (typeof ERROR_HTTP_STATUSES)[number];

export const ERROR_SURFACES = ['http', 'stream', 'tool', 'job'] as const;
export type ErrorSurface = (typeof ERROR_SURFACES)[number];

/** Yeniden deneme sınıfı (044 §12.2). */
export const ERROR_RETRY_CLASSES = ['never', 'after', 'backoff', 'user'] as const;
export type ErrorRetryClass = (typeof ERROR_RETRY_CLASSES)[number];

/** İzinli `meta` anahtarları: kapalı küme, içeriksiz değerler (044 §5.4). */
export const ERROR_META_KEYS = [
  'messageId',
  'existingFileId',
  'maxBytes',
  'allowedTypes',
  'remainingBytes',
  'balance',
  'required',
  'currentVersion',
  'source',
  'seats',
  'used',
  'blockers',
  'pending',
  'retryAfterSec',
  'limit',
] as const;
export type ErrorMetaKey = (typeof ERROR_META_KEYS)[number];

export type ErrorSpec = {
  /** `null` = yalnız araç yüzü (HTTP yok). */
  http: ErrorHttpStatus | null;
  surfaces: readonly ErrorSurface[];
  retry: ErrorRetryClass;
  /** 429 ve 503 için `required` (044 §4). */
  retryAfter?: 'required' | 'optional';
  /** Kapalı `reason` kümesi. */
  reasons?: readonly string[];
  /** Sunucunun gönderebileceği en geniş eylem kümesi. */
  actions?: readonly ErrorAction[];
  /** İzinli `meta` anahtarları. */
  meta?: readonly ErrorMetaKey[];
  /** Varsayılan Türkçe metin (messages.tr.ts). */
  message: string;
  /** `reason`'a özgü Türkçe metin (messages.tr.ts). */
  messageByReason?: Readonly<Partial<Record<string, string>>>;
};

type ErrorSpecBase = Omit<ErrorSpec, 'message' | 'messageByReason'>;

const H = ['http'] as const;
const HS = ['http', 'stream'] as const;
const HJ = ['http', 'job'] as const;
const HSJ = ['http', 'stream', 'job'] as const;
const T = ['tool'] as const;

// Satır sırası 044 §6 tablolarını izler.
const ERROR_SPECS = {
  // §6.1 AUTH_
  AUTH_UNAUTHENTICATED: { http: 401, surfaces: H, retry: 'never', actions: ['login'] },
  AUTH_SESSION_EXPIRED: {
    http: 401,
    surfaces: H,
    retry: 'never',
    reasons: ['absolute_timeout'],
    actions: ['login'],
  },
  AUTH_FORBIDDEN: {
    http: 403,
    surfaces: H,
    retry: 'never',
    reasons: [
      'origin_mismatch',
      'staff_on_app_surface',
      'verification_rejected',
      'mfa_required_role',
      'supervision_disabled',
      'approval_required',
      'policy_denied',
      'download_token_invalid',
    ],
    actions: ['reload'],
  },
  AUTH_MFA_REQUIRED: {
    http: 403,
    surfaces: H,
    retry: 'never',
    reasons: ['mfa_required_role', 'mfa_required_org', 'mfa_required_client_data'],
    actions: ['enroll_totp', 'enroll_passkey'],
  },
  AUTH_STEP_UP_REQUIRED: { http: 403, surfaces: H, retry: 'user', actions: ['step_up'] },
  AUTH_PENDING_VERIFICATION: {
    http: 403,
    surfaces: H,
    retry: 'never',
    actions: ['open_kunye_check'],
  },
  AUTH_SUSPENDED: {
    http: 403,
    surfaces: H,
    retry: 'never',
    reasons: ['user_suspended', 'org_suspended'],
    actions: ['contact_support'],
  },
  AUTH_ERASURE_BLOCKED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: [
      'memberships_exist',
      'is_owner_with_members',
      'records_to_transfer',
      'pending_closure',
    ],
    actions: ['offboard_member', 'contact_support'],
    meta: ['blockers'],
  },

  // §6.2 ORG_, SEAT_
  ORG_NO_ACTIVE: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['no_active_org', 'active_org_changed'],
    actions: ['select_org', 'reload'],
  },
  ORG_NOT_MEMBER: { http: 403, surfaces: H, retry: 'never' },
  ORG_ROLE_INSUFFICIENT: { http: 403, surfaces: H, retry: 'never' },
  ORG_MEMBER_TRANSFER_REQUIRED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['owns_cases', 'owns_documents', 'owns_conversations', 'is_owner'],
    actions: ['offboard_member'],
  },
  ORG_CLOSING: { http: 403, surfaces: H, retry: 'never', actions: ['contact_support'] },
  ORG_FROZEN: { http: 403, surfaces: H, retry: 'never', actions: ['contact_support'] },
  ORG_CLOSURE_BLOCKED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['closure_in_progress', 'legal_hold'],
  },
  SEAT_LIMIT_REACHED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['seat_limit', 'seats_in_use'],
    actions: ['manage_seats', 'upgrade_plan'],
    meta: ['seats', 'used'],
  },

  // §6.3 CASE_
  CASE_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  CASE_ACCESS_DENIED: { http: 404, surfaces: H, retry: 'never' },
  CASE_DELETE_BLOCKED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['legal_hold', 'client_in_use', 'case_archived'],
  },

  // §6.4 FILE_
  FILE_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  FILE_TOO_LARGE: { http: 413, surfaces: H, retry: 'never', meta: ['maxBytes'] },
  FILE_TYPE_NOT_ALLOWED: {
    http: 415,
    surfaces: HJ,
    retry: 'never',
    reasons: ['unsupported', 'type_mismatch', 'preview_unsupported', 'kunye_check_type'],
    meta: ['allowedTypes'],
  },
  FILE_PAGE_LIMIT: { http: 422, surfaces: HJ, retry: 'never', actions: ['contact_support'] },
  FILE_QUARANTINED: { http: 422, surfaces: HJ, retry: 'never' },
  FILE_UPLOAD_DISABLED: { http: 403, surfaces: H, retry: 'never' },
  FILE_DUPLICATE: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['same_hash_in_case'],
    actions: ['view_existing_file'],
    meta: ['existingFileId'],
  },
  FILE_NOT_READY: { http: 409, surfaces: H, retry: 'never', actions: ['wait'] },
  FILE_DELETE_BLOCKED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['legal_hold', 'case_archived'],
  },
  FILE_NO_TEXT_LAYER: { http: 422, surfaces: HJ, retry: 'never' },

  // §6.5 CHAT_, LLM_, AI_POLICY_
  CHAT_STREAM_IN_PROGRESS: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['stop_and_send'],
    meta: ['messageId'],
  },
  CHAT_TURN_TIMEOUT: { http: 504, surfaces: HS, retry: 'user', reasons: ['document_job'] },
  CHAT_PII_IN_PUBLIC_MODE: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: ['pii_detected', 'sensitive_topic'],
    actions: ['remove_personal_data'],
  },
  CHAT_CONVERSATION_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  CHAT_DELETE_BLOCKED: { http: 409, surfaces: H, retry: 'never', reasons: ['legal_hold'] },
  LLM_PROVIDER_ERROR: { http: 502, surfaces: HS, retry: 'user' },
  LLM_TIMEOUT: { http: 504, surfaces: HS, retry: 'user' },
  LLM_OUTPUT_INVALID: { http: 502, surfaces: HS, retry: 'user' },
  LLM_TASK_CAP_REACHED: { http: 200, surfaces: ['stream'], retry: 'never' },
  AI_POLICY_NO_PROVIDER: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: [
      'no_provider_for_class',
      'residency_blocks',
      'case_authorization_missing',
      'sensitive_policy',
      'org_key_missing',
      'own_key_missing',
    ],
    actions: ['new_public_conversation', 'remove_personal_data', 'notify_org_admin'],
  },
  AI_POLICY_CASE_AI_DISABLED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['case_ai_disabled', 'consent_refused'],
    actions: ['notify_org_admin'],
  },
  AI_POLICY_PUBLIC_MODE_DISABLED: {
    http: 403,
    surfaces: H,
    retry: 'never',
    actions: ['notify_org_admin'],
  },
  AI_POLICY_ROLE_DISABLED: {
    http: 403,
    surfaces: H,
    retry: 'never',
    actions: ['notify_org_admin'],
  },

  // §6.6 TOOL_ (yalnız model yüzü)
  TOOL_INVALID_INPUT: { http: null, surfaces: T, retry: 'never' },
  TOOL_NO_CASE_BOUND: { http: null, surfaces: T, retry: 'never' },
  TOOL_NO_DOCUMENT_OPEN: { http: null, surfaces: T, retry: 'never' },
  TOOL_NOT_ENABLED: { http: null, surfaces: T, retry: 'never' },
  TOOL_BUDGET_EXHAUSTED: { http: null, surfaces: T, retry: 'never' },

  // §6.7 SOURCE_
  SOURCE_UNAVAILABLE: {
    http: 503,
    surfaces: H,
    retry: 'backoff',
    retryAfter: 'required',
    reasons: ['breaker_open', 'timeout', 'upstream_error', 'cache_unavailable'],
    actions: ['open_portal'],
    meta: ['source', 'retryAfterSec'],
  },
  SOURCE_BUSY: {
    http: 503,
    surfaces: H,
    retry: 'after',
    retryAfter: 'required',
    reasons: ['queue_wait_exceeded', 'breaker_open'],
    meta: ['source', 'retryAfterSec'],
  },
  SOURCE_RATE_LIMITED: {
    http: 429,
    surfaces: H,
    retry: 'never',
    retryAfter: 'required',
    reasons: ['user_live_quota', 'org_live_quota', 'turn_live_quota'],
    meta: ['source', 'retryAfterSec'],
  },
  SOURCE_NOT_IN_COVERAGE: {
    http: 422,
    surfaces: H,
    retry: 'never',
    actions: ['open_portal'],
    meta: ['source'],
  },
  SOURCE_PII_BLOCKED: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: ['pii_detected', 'detector_failed'],
    actions: ['remove_personal_data'],
    meta: ['source'],
  },
  SOURCE_DOCUMENT_NOT_FOUND: { http: 404, surfaces: H, retry: 'never', meta: ['source'] },

  // §6.8 DOC_, EXPORT_, CITATION_
  DOC_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  DOC_VERSION_CONFLICT: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['merge_changes', 'reload'],
    meta: ['currentVersion'],
  },
  DOC_SUGGESTION_STALE: { http: 409, surfaces: H, retry: 'never', actions: ['reload'] },
  DOC_SCHEMA_INVALID: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: ['block_limit', 'role_rule', 'node_invalid', 'size_limit'],
  },
  DOC_LOCKED: {
    http: 423,
    surfaces: H,
    retry: 'never',
    reasons: ['generation_in_progress', 'archived', 'status_locked'],
    actions: ['wait'],
  },
  DOC_DELETE_BLOCKED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['legal_hold', 'case_archived'],
  },
  EXPORT_BLOCKED_UNVERIFIED_CITATION: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['not_found'],
    actions: ['attest', 'add_source', 'reverify', 'remove_citation'],
  },
  EXPORT_PENDING_VERIFICATION: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['wait'],
    meta: ['pending'],
  },
  EXPORT_FAILED: { http: 500, surfaces: HJ, retry: 'user' },
  EXPORT_EXPIRED: { http: 410, surfaces: H, retry: 'never' },
  EXPORT_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  CITATION_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  CITATION_ATTESTATION_REQUIRED: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['attest', 'add_source', 'reverify', 'remove_citation'],
  },
  CITATION_NOT_ATTESTABLE: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: ['pending', 'already_verified', 'already_attested'],
  },
  CITATION_USER_SOURCE_MISMATCH: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: ['court', 'chamber', 'esas_no', 'karar_no', 'date'],
  },
  CITATION_USER_SOURCE_UNPARSEABLE: {
    http: 422,
    surfaces: H,
    retry: 'never',
    actions: ['attest'],
  },

  // §6.9 CAL_, DEADLINE_
  CAL_INVALID_RANGE: { http: 422, surfaces: H, retry: 'never' },
  CAL_EVENT_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  DEADLINE_RULE_UNVERIFIED: { http: 422, surfaces: H, retry: 'never' },
  DEADLINE_HOLIDAY_DATA_MISSING: { http: 200, surfaces: H, retry: 'never' },
  DEADLINE_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },

  // §6.10 BILLING_, QUOTA_, PARTNER_, ADMIN_
  BILLING_PAYMENT_FAILED: {
    http: 402,
    surfaces: H,
    retry: 'never',
    // AS önerisi: `3ds_failed` 044 §2.1 reason biçimine uymuyor; ad korunur, desen gevşetildi.
    reasons: ['declined', '3ds_failed', 'insufficient_funds', 'unknown'],
  },
  BILLING_WEBHOOK_INVALID: { http: 400, surfaces: H, retry: 'never' },
  BILLING_COUPON_INVALID: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: ['not_found', 'expired', 'exhausted', 'already_redeemed', 'plan_mismatch'],
  },
  BILLING_SUBSCRIPTION_EXISTS: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['contact_support'],
  },
  BILLING_SUBSCRIPTION_REQUIRED: {
    http: 402,
    surfaces: H,
    retry: 'never',
    actions: ['upgrade_plan'],
  },
  BILLING_PLAN_NOT_AVAILABLE: { http: 422, surfaces: H, retry: 'never' },
  BILLING_PROFILE_REQUIRED: { http: 422, surfaces: H, retry: 'never' },
  BILLING_PROVIDER_UNAVAILABLE: {
    http: 503,
    surfaces: H,
    retry: 'backoff',
    retryAfter: 'required',
    meta: ['retryAfterSec'],
  },
  BILLING_SEATS_IN_USE: {
    http: 409,
    surfaces: H,
    retry: 'never',
    actions: ['manage_seats'],
    meta: ['seats', 'used'],
  },
  BILLING_CHECKOUT_EXPIRED: { http: 410, surfaces: H, retry: 'never' },
  QUOTA_INSUFFICIENT_CREDITS: {
    http: 402,
    surfaces: H,
    retry: 'never',
    actions: ['buy_credits', 'upgrade_plan'],
    meta: ['balance', 'required'],
  },
  QUOTA_CONCURRENCY_LIMIT: {
    http: 429,
    surfaces: H,
    retry: 'never',
    retryAfter: 'optional',
    reasons: ['upload'],
    meta: ['limit', 'retryAfterSec'],
  },
  QUOTA_PAGE_QUOTA_EXCEEDED: {
    http: 402,
    surfaces: HJ,
    retry: 'never',
    actions: ['upgrade_plan'],
  },
  QUOTA_STORAGE_EXCEEDED: {
    http: 402,
    surfaces: H,
    retry: 'never',
    actions: ['manage_seats', 'upgrade_plan'],
    meta: ['remainingBytes'],
  },
  QUOTA_DAILY_COST_CAP: {
    http: 429,
    surfaces: H,
    retry: 'never',
    retryAfter: 'required',
    reasons: [
      'platform_key_user_day',
      'platform_key_user_month',
      'platform_key_org_day',
      'platform_key_platform_day',
    ],
    actions: ['contact_support'],
    meta: ['retryAfterSec'],
  },
  PARTNER_NOT_ENABLED: { http: 404, surfaces: H, retry: 'never' },
  ADMIN_FORBIDDEN: {
    http: 403,
    surfaces: H,
    retry: 'never',
    reasons: ['not_staff', 'passkey_required', 'permission_missing'],
  },

  // §6.11 KVKK_
  KVKK_MASKING_FAILED: {
    http: 503,
    surfaces: HS,
    retry: 'never',
    retryAfter: 'required',
    meta: ['retryAfterSec'],
  },
  KVKK_PREVIEW_FAILED: {
    http: 503,
    surfaces: H,
    retry: 'backoff',
    retryAfter: 'required',
    reasons: ['timeout', 'detector_failed', 'cache_unavailable'],
    meta: ['retryAfterSec'],
  },
  KVKK_REQUEST_INVALID_STATE: { http: 409, surfaces: H, retry: 'never' },

  // §6.12 VALIDATION_, RATE_, INTERNAL_
  VALIDATION_FAILED: {
    http: 422,
    surfaces: H,
    retry: 'never',
    reasons: [
      'idempotency_key_required',
      'token_invalid',
      'type_deadline_not_allowed',
      'reminder_limit_reached',
      'deadline_derived_event',
      'event_date_in_future',
      'acknowledgement_required',
      'start_event_not_allowed',
      'service_method_not_applicable',
      'event_date_out_of_range',
      'rule_not_effective',
      'court_unknown',
      'channel_mandatory',
      'api_key_rejected',
      'push_endpoint_not_allowed',
      'amount_out_of_range',
      'notice_period_too_short',
      'invalid_month',
      'case_file_limit',
      'empty_file',
      'bundle_too_large',
      'profession_required',
    ],
  },
  VALIDATION_MALFORMED_BODY: { http: 400, surfaces: H, retry: 'never' },
  VALIDATION_PAYLOAD_TOO_LARGE: { http: 413, surfaces: H, retry: 'never', meta: ['maxBytes'] },
  VALIDATION_UNSUPPORTED_MEDIA_TYPE: { http: 415, surfaces: H, retry: 'never' },
  VALIDATION_ROUTE_NOT_FOUND: { http: 404, surfaces: H, retry: 'never' },
  VALIDATION_CURSOR_INVALID: { http: 400, surfaces: H, retry: 'never' },
  VALIDATION_IDEMPOTENCY_KEY_REUSED: { http: 422, surfaces: H, retry: 'never' },
  VALIDATION_IDEMPOTENCY_IN_PROGRESS: {
    http: 409,
    surfaces: H,
    retry: 'after',
    retryAfter: 'required',
    meta: ['retryAfterSec'],
  },
  VALIDATION_CONFLICT: {
    http: 409,
    surfaces: H,
    retry: 'never',
    reasons: [
      'already_member',
      'invitation_pending',
      'registry_in_use',
      'reapply_cooldown',
      'export_not_ready',
      'already_exists',
      'state_changed',
      'eval_gate_missing',
    ],
    actions: ['contact_support'],
    meta: ['retryAfterSec'],
  },
  VALIDATION_RESOURCE_NOT_FOUND: {
    http: 404,
    surfaces: H,
    retry: 'never',
    reasons: [
      'client',
      'power_of_attorney',
      'party',
      'member',
      'invitation',
      'message',
      'template',
      'prompt',
      'reminder',
      'notification',
      'push_subscription',
      'ticket',
      'kvkk_request',
      'decision',
      'decision_search',
      'law',
      'article',
      'kunye_check',
      'coupon',
      'plan',
      'application',
      'org',
      'user',
      'provider',
      'model',
      'route_task',
      'flag',
      'billing_profile',
      'checkout',
      'invoice',
      'payment',
      'subscription',
      'recovery_request',
    ],
  },
  RATE_LIMITED: {
    http: 429,
    surfaces: H,
    retry: 'after',
    retryAfter: 'required',
    reasons: [
      'auth_ip',
      'auth_account',
      'api_user',
      'chat_user',
      'kvkk_preview',
      'staff_user',
      'step_up',
      'kunye_daily',
      'overview_daily',
      'coupon_attempts',
      'payment_retry_daily',
      'reverify_cooldown',
    ],
    meta: ['limit', 'retryAfterSec'],
  },
  INTERNAL_ERROR: { http: 500, surfaces: HSJ, retry: 'user' },
  INTERNAL_DEPENDENCY_UNAVAILABLE: {
    http: 503,
    surfaces: HJ,
    retry: 'after',
    retryAfter: 'required',
    reasons: ['timeout', 'payment_provider', 'storage'],
    meta: ['retryAfterSec'],
  },
  INTERNAL_MAINTENANCE: {
    http: 503,
    surfaces: H,
    retry: 'after',
    retryAfter: 'required',
    reasons: ['draining', 'maintenance_mode'],
    meta: ['retryAfterSec'],
  },
} as const satisfies Record<string, ErrorSpecBase>;

type Specs = typeof ERROR_SPECS;

/** Katalogdaki kodlar; katalog dışı kod tip hatasıdır. */
export type ErrorCode = keyof Specs;

/** Kodun kapalı `reason` kümesi (yoksa `never`). */
export type ReasonOf<C extends ErrorCode> = C extends ErrorCode
  ? Specs[C] extends { reasons: readonly (infer R)[] }
    ? R
    : never
  : never;

/** Kodun izinli eylemleri (yoksa `never`). */
export type ActionOf<C extends ErrorCode> = C extends ErrorCode
  ? Specs[C] extends { actions: readonly (infer A)[] }
    ? A
    : never
  : never;

/** Kodun izinli `meta` anahtarları (yoksa `never`). */
export type MetaKeyOf<C extends ErrorCode> = C extends ErrorCode
  ? Specs[C] extends { meta: readonly (infer M)[] }
    ? M
    : never
  : never;

export type CatalogEntry<C extends ErrorCode> = Specs[C] &
  Pick<ErrorSpec, 'message' | 'messageByReason'>;

function buildCatalog(): { readonly [C in ErrorCode]: CatalogEntry<C> } {
  const out: Record<string, ErrorSpec> = {};
  for (const [code, spec] of Object.entries(ERROR_SPECS)) {
    const text: { message: string; byReason?: Readonly<Partial<Record<string, string>>> } =
      ERROR_MESSAGES_TR[code as ErrorCode];
    out[code] = {
      ...spec,
      message: text.message,
      ...(text.byReason === undefined ? {} : { messageByReason: text.byReason }),
    };
  }
  return out as { readonly [C in ErrorCode]: CatalogEntry<C> };
}

export const ERROR_CATALOG: { readonly [C in ErrorCode]: CatalogEntry<C> } = buildCatalog();
