// Kanonik enum kümeleri (002 §11); TS enum yerine sabit dizi + türetilmiş tip.

export const ACCEPTED_FILE_TYPES = ['pdf', 'docx', 'udf', 'png', 'jpeg', 'tiff', 'txt'] as const;
export type AcceptedFileType = (typeof ACCEPTED_FILE_TYPES)[number];

export const AI_DATA_RESIDENCIES = ['eu_or_tr', 'tr_only', 'public_only', 'local_only'] as const;
export type AiDataResidency = (typeof AI_DATA_RESIDENCIES)[number];

export const AI_KEY_SOURCES = ['org', 'own'] as const;
export type AiKeySource = (typeof AI_KEY_SOURCES)[number];

export const AI_MODEL_CAPABILITY_KEYS = [
  'tools',
  'parallel_tools',
  'strict_tools',
  'thinking_param',
  'reasoning_echo_required',
  'tool_choice_in_thinking',
  'json_schema_output',
  'prefix_cache',
  'max_output_tokens',
  'vision',
] as const;
export type AiModelCapabilityKey = (typeof AI_MODEL_CAPABILITY_KEYS)[number];

export const AI_POLICY_ACCEPTANCE_KINDS = [
  'org_ai_policy',
  'public_mode_enable',
  'case_ai_authorization',
  'sensitive_eu_scc_ack',
] as const;
export type AiPolicyAcceptanceKind = (typeof AI_POLICY_ACCEPTANCE_KINDS)[number];

export const AI_PROVIDER_IDS = [
  'deepseek',
  'azure-eu',
  'vertex-eu',
  'anthropic',
  'anthropic-eu',
  'local',
  'mock',
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_PROVIDER_KINDS = [
  'deepseek',
  'azure',
  'vertex',
  'anthropic',
  'openai_compatible',
  'mock',
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_PROVIDER_REGIONS = ['TR', 'EU', 'US', 'CN', 'NONE'] as const;
export type AiProviderRegion = (typeof AI_PROVIDER_REGIONS)[number];

export const AI_TASKS = [
  'chat',
  'draft_document',
  'edit_document',
  'title',
  'summarize_history',
  'search_overview',
  'decision_summary',
  'file_card',
  'pii_risk_check',
  'citation_support_check',
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_USAGE_FLAGS = [
  'cjk_leak',
  'mock',
  'dev_real_llm',
  'beta_synthetic',
  'no_tools_mode',
  'reasoning_dropped',
  'truncated_input',
  'probe',
] as const;
export type AiUsageFlag = (typeof AI_USAGE_FLAGS)[number];

export const AI_USAGE_STATUSES = ['success', 'error', 'timeout', 'stopped'] as const;
export type AiUsageStatus = (typeof AI_USAGE_STATUSES)[number];

export const ALIAS_SOURCES = ['fixed', 'user_choice', 'conversation_last', 'local_engine'] as const;
export type AliasSource = (typeof ALIAS_SOURCES)[number];

export const ANNOUNCEMENT_AUDIENCES = ['all', 'org_admins'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const APPLICATION_REJECT_REASONS = [
  'not_found_in_registry',
  'identity_mismatch',
  'incomplete_information',
  'duplicate_registry',
  'not_eligible',
  'other',
] as const;
export type ApplicationRejectReason = (typeof APPLICATION_REJECT_REASONS)[number];

export const AUDIT_ACTOR_TYPES = ['user', 'platform_staff', 'system'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const BILLING_CHECKOUT_STATUSES = [
  'created',
  'awaiting_payment',
  'completed',
  'failed',
  'expired',
] as const;
export type BillingCheckoutStatus = (typeof BILLING_CHECKOUT_STATUSES)[number];

export const BILLING_EVENT_OUTCOMES = [
  'applied',
  'ignored',
  'amount_mismatch',
  'unknown_subscription',
  'failed',
] as const;
export type BillingEventOutcome = (typeof BILLING_EVENT_OUTCOMES)[number];

export const BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const BILLING_TAX_KINDS = ['tckn', 'vkn'] as const;
export type BillingTaxKind = (typeof BILLING_TAX_KINDS)[number];

export const BREAKER_STATES = ['closed', 'open', 'half_open'] as const;
export type BreakerState = (typeof BREAKER_STATES)[number];

export const CALENDAR_EVENT_TYPES = [
  'hearing',
  'deadline',
  'discovery',
  'expert',
  'meeting',
  'mediation',
  'task',
] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CASE_AI_LOG_OUTCOMES = ['success', 'error', 'timeout', 'stopped'] as const;
export type CaseAiLogOutcome = (typeof CASE_AI_LOG_OUTCOMES)[number];

export const CASE_SENSITIVITIES = ['normal', 'sensitive'] as const;
export type CaseSensitivity = (typeof CASE_SENSITIVITIES)[number];

export const CASE_STATUSES = ['active', 'on_hold', 'closed', 'archived'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_VISIBILITIES = ['org', 'restricted'] as const;
export type CaseVisibility = (typeof CASE_VISIBILITIES)[number];

export const CHAMBER_KINDS = [
  'civil',
  'criminal',
  'administrative',
  'tax',
  'general_assembly',
  'board',
] as const;
export type ChamberKind = (typeof CHAMBER_KINDS)[number];

export const CLASS_RULES = ['turn', 'conversation', 'fixed_public', 'fixed_case'] as const;
export type ClassRule = (typeof CLASS_RULES)[number];

export const CLIENT_AI_CONSENTS = ['unknown', 'granted', 'refused'] as const;
export type ClientAiConsent = (typeof CLIENT_AI_CONSENTS)[number];

export const CLIENT_KINDS = ['person', 'entity'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export const CORPUS_REJECT_REASONS = [
  'source_disabled',
  'invalid_document_id',
  'withdrawn',
  'empty_text',
  'no_kunye',
  'invalid_date',
  'parse_error',
  'buffer_miss',
  'busy_deferral_exhausted',
  'duplicate',
  'content_drift',
  'license_missing',
  'unsupported_law_type',
  'bulk_disabled',
  'legal_basis_missing',
] as const;
export type CorpusRejectReason = (typeof CORPUS_REJECT_REASONS)[number];

export const COUPON_DISCOUNT_TYPES = ['percent', 'amount'] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

export const COURT_TYPES_DB = [
  'constitutional_court',
  'court_of_cassation',
  'council_of_state',
  'jurisdictional_disputes_court',
  'regional_court_of_appeal',
  'regional_administrative_court',
  'civil_first_instance',
  'civil_peace',
  'commercial',
  'labor',
  'family',
  'consumer',
  'land_registry',
  'intellectual_property',
  'enforcement_court',
  'heavy_criminal',
  'criminal_first_instance',
  'criminal_peace_judgeship',
  'juvenile',
  'administrative',
  'tax',
  'enforcement_office',
  'other',
] as const;
export type CourtTypeDb = (typeof COURT_TYPES_DB)[number];

export const CREDIT_ENTRY_TYPES = [
  'trial_grant',
  'monthly_grant',
  'purchase',
  'consume',
  'refund',
  'adjustment',
  'expire',
] as const;
export type CreditEntryType = (typeof CREDIT_ENTRY_TYPES)[number];

export const CREDIT_OP_CODES = [
  'chat_fast',
  'chat_deep',
  'document_draft',
  'edit_round',
  'file_card',
  'ocr_20_pages',
  'decision_search',
  'legislation_search',
  'kunye_check',
  'citation_verify',
  'deadline_calc',
  'search_overview',
  'title',
  'summarize',
] as const;
export type CreditOpCode = (typeof CREDIT_OP_CODES)[number];

export const CUSTODY_EVENTS = [
  'upload',
  'view',
  'download',
  'export',
  'move',
  'delete_request',
  'delete_cancel',
  'delete',
] as const;
export type CustodyEvent = (typeof CUSTODY_EVENTS)[number];

export const DATA_CLASSES = ['public', 'client', 'case'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const DEADLINE_ACKNOWLEDGEMENTS = [
  'holiday_data_missing',
  'contested_extension',
  'ai_extracted_date',
] as const;
export type DeadlineAcknowledgement = (typeof DEADLINE_ACKNOWLEDGEMENTS)[number];

export const DEADLINE_BRANCHES = ['hmk', 'cmk', 'iyuk', 'iik', 'mediation'] as const;
export type DeadlineBranch = (typeof DEADLINE_BRANCHES)[number];

export const DEADLINE_CHECK_STATUSES = ['match', 'mismatch', 'no_calculation'] as const;
export type DeadlineCheckStatus = (typeof DEADLINE_CHECK_STATUSES)[number];

export const DEADLINE_PERIOD_UNITS = ['day', 'week', 'month'] as const;
export type DeadlinePeriodUnit = (typeof DEADLINE_PERIOD_UNITS)[number];

export const DEADLINE_START_EVENTS = ['service', 'pronouncement', 'learning'] as const;
export type DeadlineStartEvent = (typeof DEADLINE_START_EVENTS)[number];

export const DEADLINE_STATUSES = ['open', 'filed_declared', 'cancelled'] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const DEADLINE_STEP_KINDS = [
  'start',
  'e_tebligat',
  'period',
  'recess_extension',
  'weekend_shift',
  'holiday_shift',
  'half_day',
  'contested_extension',
  'mediation_extension',
] as const;
export type DeadlineStepKind = (typeof DEADLINE_STEP_KINDS)[number];

export const DEADLINE_WARNING_CODES = [
  'holiday_data_missing',
  'half_day',
  'administrative_leave',
  'contested_extension',
  'rule_unverified_preview',
  'saturday_shift',
] as const;
export type DeadlineWarningCode = (typeof DEADLINE_WARNING_CODES)[number];

export const DECISION_ORIGINS = ['corpus', 'live'] as const;
export type DecisionOrigin = (typeof DECISION_ORIGINS)[number];

export const DECISION_SECTION_ROLES = [
  'kunye',
  'istem',
  'taraf_iddiasi',
  'gerekce',
  'hukum',
  'karsi_oy',
  'tetkik_hakimi',
  'diger',
] as const;
export type DecisionSectionRole = (typeof DECISION_SECTION_ROLES)[number];

export const DECISION_TEXT_STATUSES = ['full', 'unavailable'] as const;
export type DecisionTextStatus = (typeof DECISION_TEXT_STATUSES)[number];

export const DECISION_WITHDRAWN_REASONS = [
  'kvkk_request',
  'court_order',
  'source_removed',
  'legal_review',
  'quality',
] as const;
export type DecisionWithdrawnReason = (typeof DECISION_WITHDRAWN_REASONS)[number];

export const DELETION_REASONS = [
  'user_request',
  'retention',
  'kvkk_erasure',
  'org_closure',
] as const;
export type DeletionReason = (typeof DELETION_REASONS)[number];

// 002 §11.4 "Dışa aktarım biçimi"; §11.11 genişletilmiş kümesi EXPORT_FORMATS.
export const DOCUMENT_EXPORT_FORMATS = ['udf', 'docx', 'pdf'] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

export const DOCUMENT_EXPORT_STATUSES = [
  'queued',
  'processing',
  'ready',
  'failed',
  'expired',
] as const;
export type DocumentExportStatus = (typeof DOCUMENT_EXPORT_STATUSES)[number];

export const DOCUMENT_GENERATION_STATUSES = ['idle', 'queued', 'generating', 'failed'] as const;
export type DocumentGenerationStatus = (typeof DOCUMENT_GENERATION_STATUSES)[number];

export const DOCUMENT_KINDS = ['petition', 'notice', 'memo', 'free'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = [
  'draft',
  'review_pending',
  'approved',
  'exported',
  'filed_declared',
  'archived',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// Belge alt türleri (080 §1.3; katalog ve unsur matrisi `legal/petition-types.ts`).
export const DOCUMENT_SUBTYPES = [
  'claim',
  'answer',
  'reply',
  'rejoinder',
  'claim_correction',
  'expert_report_objection',
  'interim_injunction_objection',
  'excuse',
  'general_statement',
  'appeal_regional',
  'appeal_cassation',
  'enforcement_request',
  'enforcement_objection',
  'enforcement_complaint',
  'mediation_application',
  'administrative_claim',
  'tax_claim',
  'criminal_complaint',
  'criminal_objection',
  'notice_general',
  'memo_legal_opinion',
  'free_blank',
] as const;
export type DocumentSubtype = (typeof DOCUMENT_SUBTYPES)[number];

export const DOCUMENT_VERSION_SOURCES = ['user', 'ai', 'import'] as const;
export type DocumentVersionSource = (typeof DOCUMENT_VERSION_SOURCES)[number];

export const DOCUMENT_VERSION_TRIGGERS = [
  'manual',
  'suggestion_accepted',
  'pre_export',
  'session_end',
  'restore',
  'import',
  'generated',
] as const;
export type DocumentVersionTrigger = (typeof DOCUMENT_VERSION_TRIGGERS)[number];

export const EDIT_OP_TYPES = [
  'replace_block',
  'insert_after',
  'delete_block',
  'replace_text',
] as const;
export type EditOpType = (typeof EDIT_OP_TYPES)[number];

export const EMAIL_DELIVERY_STATUSES = [
  'queued',
  'sending',
  'sent',
  'failed',
  'suppressed',
  'expired',
  'cancelled',
] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/** `email_deliveries.error_code` (045 §6.5–§6.6): hata sınıfı kodları + `suppressed` nedenleri. */
export const EMAIL_ERROR_CODES = [
  'recipient_rejected',
  'recipient_suppressed',
  'provider_unavailable',
  'provider_rate_limited',
  'provider_auth',
  'sender_unverified',
  'timeout',
  'message_too_large',
  'template_unknown',
  'payload_invalid',
  'unverified',
  'banned',
  'no_recipient',
] as const;
export type EmailErrorCode = (typeof EMAIL_ERROR_CODES)[number];

/** E-posta şablon kodları (045 §7.3 + `registration_attempt`; 002 §11.11). */
export const EMAIL_TEMPLATE_CODES = [
  'verify_email',
  'password_reset',
  'invitation',
  'email_change_confirm',
  'account_recovery_ready',
  'password_changed',
  'new_device_login',
  'factor_changed',
  'backup_codes_changed',
  'email_change_notice',
  'email_changed',
  'account_recovery_requested',
  'account_recovery_completed',
  'account_recovery_cancelled',
  'org_ownership_transferred',
  'account_suspended',
  'data_breach_notice',
  'lawyer_application_received',
  'verification_approved',
  'verification_rejected',
  'kvkk_request_answered',
  'reminder',
  'deadline_due',
  'job_done',
  'credit_low',
  'retention_due',
  'provider_change_notice',
  'trial_started',
  'trial_ending',
  'subscription_activated',
  'payment_succeeded',
  'payment_failed',
  'payment_failed_final',
  'subscription_canceled',
  'subscription_expired',
  'plan_changed',
  'renewal_upcoming',
  'refund_processed',
  'invoice_ready',
  'price_change_notice',
  'announcement',
  'petition_pending_approval',
  'petition_decision',
  'registration_attempt',
] as const;
export type EmailTemplateCode = (typeof EMAIL_TEMPLATE_CODES)[number];

export const EMBED_STAGING_KINDS = ['decision', 'law_article'] as const;
export type EmbedStagingKind = (typeof EMBED_STAGING_KINDS)[number];

export const EVAL_SUITES = [
  'retrieval',
  'citations',
  'temporal',
  'kvkk_masking',
  'kvkk_suffix',
  'injection',
  'deadline',
  'tool_use',
  'quality',
  'chat_client',
  'chat_public',
  'drafting',
  'file_card',
  'provider_smoke',
  'provider_pilot',
  'cache_probe',
  'hnsw_recall',
  'corpus_coverage',
  'summary_quality',
] as const;
export type EvalSuite = (typeof EVAL_SUITES)[number];

export const EVAL_SUITE_PACKAGES = [
  'fast',
  'stack',
  'live-model',
  'prompt',
  'model',
  'retrieval_change',
  'masker',
  'release',
  'nightly',
  'weekly',
] as const;
export type EvalSuitePackage = (typeof EVAL_SUITE_PACKAGES)[number];

export const EXPORT_CHECKLIST_SEVERITIES = ['block', 'wait', 'soft', 'warn', 'info'] as const;
export type ExportChecklistSeverity = (typeof EXPORT_CHECKLIST_SEVERITIES)[number];

export const EXPORT_DATA_SCOPES = ['account', 'org', 'data_subject', 'org_closure'] as const;
export type ExportDataScope = (typeof EXPORT_DATA_SCOPES)[number];

export const EXPORT_FORMATS = ['udf', 'docx', 'pdf', 'zip'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_SUBJECT_TYPES = [
  'document',
  'case_ai_log',
  'conversation',
  'data',
  'kunye_check',
  'case_files',
] as const;
export type ExportSubjectType = (typeof EXPORT_SUBJECT_TYPES)[number];

export const EXTRACTION_METHODS = ['text_layer', 'ocr'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const FEEDBACK_CATEGORIES = [
  'incorrect',
  'unverified_citation',
  'incomplete',
  'outdated',
  'formatting',
  'other',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FILE_CARD_STATUSES = ['pending', 'ready', 'failed', 'skipped'] as const;
export type FileCardStatus = (typeof FILE_CARD_STATUSES)[number];

export const FILE_DOC_TYPES = [
  'petition',
  'decision',
  'interim_decision',
  'service_notice',
  'expert_report',
  'minutes',
  'indictment',
  'contract',
  'power_of_attorney',
  'evidence',
  'other',
] as const;
export type FileDocType = (typeof FILE_DOC_TYPES)[number];

export const FILE_ORIGINS = [
  'case_upload',
  'chat_attachment',
  'kunye_check',
  'document_import',
] as const;
export type FileOrigin = (typeof FILE_ORIGINS)[number];

export const FILE_STATUSES = [
  'uploaded',
  'scanning',
  'extracting',
  'chunking',
  'embedding',
  'ready',
  'failed',
  'quarantined',
  'ocr_skipped',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const FILE_STATUS_REASONS = [
  'av_detected',
  'av_unavailable',
  'zip_bomb',
  'zip_slip',
  'xxe_blocked',
  'macro_detected',
  'encrypted_pdf',
  'corrupt',
  'unsupported_structure',
  'page_limit',
  'page_quota',
  'credits',
  'timeout',
  'doc_engine_error',
  'object_missing',
  'integrity_failed',
  'embed_quota',
] as const;
export type FileStatusReason = (typeof FILE_STATUS_REASONS)[number];

export const HIDDEN_CONTENT_KINDS = [
  'white_text',
  'tiny_text',
  'offpage_text',
  'hidden_layer',
  'docx_hidden_run',
  'docx_comment',
  'docx_tracked_deletion',
  'pdf_annotation_text',
  'pdf_active_content',
] as const;
export type HiddenContentKind = (typeof HIDDEN_CONTENT_KINDS)[number];

export const HOLIDAY_KINDS = ['official', 'religious', 'administrative_leave'] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

/** `corpus.ingestion_runs.params.phase` (034 §5.3, §10; jsonb alanı, DB CHECK yok). */
export const INGESTION_PHASES = ['fetch', 'awaiting_gpu_vectors', 'load', 'index', 'done'] as const;
export type IngestionPhase = (typeof INGESTION_PHASES)[number];

export const INGESTION_RUN_KINDS = [
  'live_hit',
  'bulk',
  'legislation_snapshot',
  'reembed',
  'decision_summary',
] as const;
export type IngestionRunKind = (typeof INGESTION_RUN_KINDS)[number];

export const INGESTION_RUN_STATUSES = ['running', 'succeeded', 'partial', 'failed'] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'canceled'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const KUNYE_CHECK_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type KunyeCheckStatus = (typeof KUNYE_CHECK_STATUSES)[number];

export const KUNYE_STATUSES = [
  'pending',
  'verified',
  'verified_user_source',
  'out_of_context',
  'out_of_coverage',
  'source_unavailable',
  'not_found',
  'attested',
] as const;
export type KunyeStatus = (typeof KUNYE_STATUSES)[number];

export const KVKK_REJECTION_REASONS = [
  'identity_unverified',
  'not_found',
  'retention_obligation',
  'legal_hold',
  'third_party_rights',
  'manifestly_unfounded',
  'out_of_scope',
] as const;
export type KvkkRejectionReason = (typeof KVKK_REJECTION_REASONS)[number];

export const KVKK_REQUEST_SCOPES = ['org_data', 'own_account'] as const;
export type KvkkRequestScope = (typeof KVKK_REQUEST_SCOPES)[number];

export const KVKK_REQUEST_STATUSES = ['received', 'in_progress', 'completed', 'rejected'] as const;
export type KvkkRequestStatus = (typeof KVKK_REQUEST_STATUSES)[number];

export const KVKK_REQUEST_TYPES = [
  'access',
  'rectification',
  'erasure',
  'objection',
  'export',
] as const;
export type KvkkRequestType = (typeof KVKK_REQUEST_TYPES)[number];

export const LAW_STATUSES = ['in_force', 'repealed'] as const;
export type LawStatus = (typeof LAW_STATUSES)[number];

export const LAW_TYPES = [
  'constitution',
  'law',
  'decree_law',
  'presidential_decree',
  'regulation',
] as const;
export type LawType = (typeof LAW_TYPES)[number];

export const LEGAL_HOLD_REASONS = [
  'court_order',
  'investigation',
  'dispute',
  'regulatory',
  'other',
] as const;
export type LegalHoldReason = (typeof LEGAL_HOLD_REASONS)[number];

export const LIVE_REASONS = [
  'few_local_results',
  'recent_date_filter',
  'specific_kunye',
  'user_requested',
  'low_score',
] as const;
export type LiveReason = (typeof LIVE_REASONS)[number];

export const LIVE_SEARCH_STATUSES = [
  'none',
  'done',
  'stale',
  'busy',
  'unavailable',
  'blocked_pii',
] as const;
export type LiveSearchStatus = (typeof LIVE_SEARCH_STATUSES)[number];

export const MASKING_ORIGIN_KINDS = [
  'user_text',
  'attachment',
  'file_mention',
  'case_binding',
  'case_tool_result',
  'corpus',
  'live_source',
  'system',
] as const;
export type MaskingOriginKind = (typeof MASKING_ORIGIN_KINDS)[number];

export const MASKING_TYPE_CODES = [
  'KISI',
  'TCKN',
  'VKN',
  'TEL',
  'EPOSTA',
  'IBAN',
  'ADRES',
  'SIRKET',
  'PLAKA',
  'DOSYA',
  'TARIH_DOGUM',
  'SAGLIK',
] as const;
export type MaskingTypeCode = (typeof MASKING_TYPE_CODES)[number];

export const MATCH_KINDS = ['kunye_exact', 'article_citation', 'hybrid'] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

export const MCP_LAW_TYPES = [
  'kanun',
  'khk',
  'cbk',
  'tuzuk',
  'yonetmelik',
  'teblig',
  'diger',
] as const;
export type McpLawType = (typeof MCP_LAW_TYPES)[number];

export const MEMBER_ROLES = [
  'owner',
  'admin',
  'senior_lawyer',
  'lawyer',
  'trainee',
  'assistant',
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATUSES = ['active', 'suspended'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = [
  'streaming',
  'complete',
  'stopped',
  'error',
  'interrupted',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MFA_LEVELS = ['none', 'totp', 'passkey'] as const;
export type MfaLevel = (typeof MFA_LEVELS)[number];

// 002 §11.7 "MVP canlı" sütunu Açık olan kaynak kodları.
export const MVP_LIVE_SOURCE_CODES = ['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat'] as const;
export type MvpLiveSourceCode = (typeof MVP_LIVE_SOURCE_CODES)[number];

export const NOTE_CODES = [
  'goodwill',
  'service_incident',
  'refund_reversal',
  'beta_grant',
  'migration',
  'correction',
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export const NOTICE_CODES = [
  'simulation',
  'beta_synthetic',
  'source_unavailable',
  'source_busy',
  'live_fallback_local',
  'masking_applied',
  'provider_switched',
  'chinese_leak',
  'task_cap_reached',
  'outline_invalid',
  'hidden_content',
  'context_compacted',
  'search_degraded',
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CLASSES = ['security', 'deadline', 'action', 'service'] as const;
export type NotificationClass = (typeof NOTIFICATION_CLASSES)[number];

/** `email_deliveries.kind` (045 §3.2 + `registration_attempt`; 002 §11.11). */
export const NOTIFICATION_KINDS = [
  'email_verification',
  'password_reset',
  'password_changed',
  'new_device_login',
  'factor_changed',
  'backup_codes_changed',
  'email_change_requested',
  'email_changed',
  'account_recovery_requested',
  'account_recovery_ready',
  'account_recovery_completed',
  'account_recovery_cancelled',
  'org_ownership_transferred',
  'account_suspended',
  'data_breach_notice',
  'invitation',
  'lawyer_application_received',
  'verification_approved',
  'verification_rejected',
  'kvkk_request_answered',
  'reminder',
  'deadline_due',
  'file_ready',
  'file_failed',
  'export_ready',
  'kunye_check_ready',
  'credit_low',
  'retention_due',
  'provider_change_notice',
  'trial_started',
  'trial_ending',
  'subscription_activated',
  'payment_succeeded',
  'payment_failed',
  'payment_failed_final',
  'subscription_canceled',
  'subscription_expired',
  'plan_changed',
  'renewal_upcoming',
  'refund_processed',
  'invoice_ready',
  'price_change_notice',
  'announcement',
  'petition_pending_approval',
  'petition_decision',
  'registration_attempt',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'reminder',
  'deadline_due',
  'file_ready',
  'file_failed',
  'export_ready',
  'kunye_check_ready',
  'invitation',
  'verification_approved',
  'verification_rejected',
  'credit_low',
  'provider_change_notice',
  'announcement',
  'retention_due',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ORG_CLOSURE_BLOCKED_REASONS = ['legal_hold', 'export_incomplete'] as const;
export type OrgClosureBlockedReason = (typeof ORG_CLOSURE_BLOCKED_REASONS)[number];

export const ORG_CLOSURE_MODES = ['standard', 'account_erasure'] as const;
export type OrgClosureMode = (typeof ORG_CLOSURE_MODES)[number];

export const ORG_CLOSURE_PHASES = ['return', 'frozen', 'deleting', 'deleted', 'cancelled'] as const;
export type OrgClosurePhase = (typeof ORG_CLOSURE_PHASES)[number];

export const ORG_KEY_STATUSES = ['active', 'retiring', 'retired', 'shredded'] as const;
export type OrgKeyStatus = (typeof ORG_KEY_STATUSES)[number];

export const ORG_KINDS = ['individual', 'firm'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const ORG_SUSPEND_REASONS = [
  'non_payment',
  'abuse',
  'security',
  'legal_request',
  'owner_request',
  'other',
] as const;
export type OrgSuspendReason = (typeof ORG_SUSPEND_REASONS)[number];

export const PARTNER_COMMISSION_STATUSES = ['calculated', 'approved', 'paid'] as const;
export type PartnerCommissionStatus = (typeof PARTNER_COMMISSION_STATUSES)[number];

export const PARTNER_MEMBER_ROLES = ['partner_owner', 'partner_staff'] as const;
export type PartnerMemberRole = (typeof PARTNER_MEMBER_ROLES)[number];

export const PARTNER_ORG_SOURCES = ['partner_code', 'manual'] as const;
export type PartnerOrgSource = (typeof PARTNER_ORG_SOURCES)[number];

export const PARTY_ROLES = [
  'plaintiff',
  'defendant',
  'intervener',
  'complainant',
  'participant',
  'accused',
  'creditor',
  'debtor',
  'applicant',
  'third_party',
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYOUT_REPORT_STATUSES = ['provisional', 'final'] as const;
export type PayoutReportStatus = (typeof PAYOUT_REPORT_STATUSES)[number];

export const PENDING_FILE_JOB_NAMES = [
  'file.scan',
  'file.extract',
  'file.ocr',
  'file.chunk',
  'file.embed',
  'file.card',
] as const;
export type PendingFileJobName = (typeof PENDING_FILE_JOB_NAMES)[number];

export const PENDING_FILE_QUEUES = ['files-interactive', 'files-batch'] as const;
export type PendingFileQueue = (typeof PENDING_FILE_QUEUES)[number];

export const PERIOD_NATURES = ['procedural', 'forfeiture', 'process'] as const;
export type PeriodNature = (typeof PERIOD_NATURES)[number];

export const PIPELINE_STAGES = [
  'masking',
  'retrieval',
  'live_queue',
  'tool',
  'file_processing',
  'compaction',
  'synthesis',
  'document',
  'verification',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STATUSES = ['started', 'progress', 'done', 'skipped', 'error'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PLAN_CODES = [
  'trial',
  'trainee',
  'lawyer',
  'lawyer_pro',
  'firm',
  'enterprise',
] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PLATFORM_ROLES = ['user', 'support', 'super_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const POWER_OF_ATTORNEY_SCOPE_KINDS = ['general', 'special'] as const;
export type PowerOfAttorneyScopeKind = (typeof POWER_OF_ATTORNEY_SCOPE_KINDS)[number];

export const PREFIX_CACHE_MODES = ['deepseek_unit', 'auto', 'explicit_breakpoint', 'none'] as const;
export type PrefixCacheMode = (typeof PREFIX_CACHE_MODES)[number];

export const PRICING_WINDOWS = ['peak', 'off_peak', 'flat'] as const;
export type PricingWindow = (typeof PRICING_WINDOWS)[number];

export const PRODUCT_EVENT_NAMES = [
  'answer_with_verified_citation',
  'document_exported',
  'deadline_approved',
  'kunye_check_completed',
  'trial_converted',
  'weekly_active',
  'file_uploaded',
  'conversation_started',
] as const;
export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_METRIC_CODES = [
  'time_to_first_verified_answer',
  'weekly_active_lawyers',
  'petitions_exported',
  'deadlines_confirmed',
  'kunye_checks_run',
  'trial_to_paid_conversion',
] as const;
export type ProductMetricCode = (typeof PRODUCT_METRIC_CODES)[number];

export const PROMPT_LIBRARY_SCOPES = ['user', 'org'] as const;
export type PromptLibraryScope = (typeof PROMPT_LIBRARY_SCOPES)[number];

export const PROMPT_VERSION_STATUSES = ['draft', 'active', 'retired'] as const;
export type PromptVersionStatus = (typeof PROMPT_VERSION_STATUSES)[number];

export const RECOVERY_APPROVAL_PATHS = ['org_owner', 'staff'] as const;
export type RecoveryApprovalPath = (typeof RECOVERY_APPROVAL_PATHS)[number];

export const RECOVERY_EVIDENCE_CODES = ['kep_verified', 'document_verified'] as const;
export type RecoveryEvidenceCode = (typeof RECOVERY_EVIDENCE_CODES)[number];

export const RECOVERY_KINDS = ['mfa_reset', 'email_change'] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

export const RECOVERY_STATUSES = [
  'awaiting_approval',
  'waiting',
  'ready',
  'completed',
  'canceled',
  'rejected',
  'expired',
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

export const REFUND_REASONS = ['goodwill', 'service_fault', 'duplicate', 'fraud'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const RELEVANCE_LABELS = ['high', 'medium'] as const;
export type RelevanceLabel = (typeof RELEVANCE_LABELS)[number];

export const REMINDER_STATUSES = ['scheduled', 'sent', 'failed', 'cancelled'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const RESERVATION_STATUSES = ['held', 'settled', 'released', 'expired'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RETRIEVAL_SURFACES = [
  'eager',
  'tool',
  'archive',
  'legislation',
  'case_files',
] as const;
export type RetrievalSurface = (typeof RETRIEVAL_SURFACES)[number];

export const SEARCH_COURT_TYPES = [
  'yargitay',
  'danistay',
  'istinaf_hukuk',
  'ilk_derece_hukuk',
  'kyb',
  'aym_bireysel',
  'aym_norm',
  'uyusmazlik',
  'kik',
  'rekabet',
  'gib',
] as const;
export type SearchCourtType = (typeof SEARCH_COURT_TYPES)[number];

export const SEARCH_OVERVIEW_STATUSES = ['none', 'ready', 'skipped_pii', 'unavailable'] as const;
export type SearchOverviewStatus = (typeof SEARCH_OVERVIEW_STATUSES)[number];

export const SECTION_ROLES = [
  'courtHeader',
  'partiesGrid',
  'subjectLine',
  'numberedExplanations',
  'legalGrounds',
  'evidenceList',
  'resultAndRequest',
  'attorneySignature',
  'generic',
  'freeSection',
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export const SENSITIVE_CASE_POLICIES = ['tr_only', 'eu_scc_with_ack', 'ai_off'] as const;
export type SensitiveCasePolicy = (typeof SENSITIVE_CASE_POLICIES)[number];

export const SENSITIVE_TOPIC_CODES = [
  'criminal',
  'child',
  'family',
  'health',
  'asylum_migration',
  'trade_secret',
  'capital_markets',
] as const;
export type SensitiveTopicCode = (typeof SENSITIVE_TOPIC_CODES)[number];

export const SERVICE_METHODS = ['postal', 'e_tebligat'] as const;
export type ServiceMethod = (typeof SERVICE_METHODS)[number];

export const SESSION_SURFACES = ['app', 'admin'] as const;
export type SessionSurface = (typeof SESSION_SURFACES)[number];

export const SOURCE_CODES = [
  'bedesten',
  'anayasa',
  'uyusmazlik',
  'mevzuat',
  'kik',
  'rekabet',
  'gib',
  'yargitay',
  'danistay',
  'emsal',
  'sayistay',
  'kvkk',
  'bddk',
  'sigorta_tahkim',
] as const;
export type SourceCode = (typeof SOURCE_CODES)[number];

/** `corpus.source_canary_runs.probe` (021 §7.3): günlük canary yoklamaları (kaynak + araç). */
export const SOURCE_CANARY_PROBES = [
  'uyap_search',
  'anayasa_search',
  'uyusmazlik_search',
  'mevzuat_search',
  'mevzuat_article',
] as const;
export type SourceCanaryProbe = (typeof SOURCE_CANARY_PROBES)[number];

/** `corpus.source_canary_runs.outcome` (021 §7.3): `ok` dışındaki her sonuç başarısızdır. */
export const SOURCE_CANARY_OUTCOMES = ['ok', 'empty', 'error', 'timeout'] as const;
export type SourceCanaryOutcome = (typeof SOURCE_CANARY_OUTCOMES)[number];

export const SOURCE_KINDS = ['decision', 'legislation', 'case_file', 'user_source'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_ORIGINS = ['corpus', 'live', 'user'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const SOURCE_STATES = ['up', 'degraded', 'down', 'disabled'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

export const SUBSCRIPTION_CHANGE_KINDS = ['user', 'price', 'coupon_end'] as const;
export type SubscriptionChangeKind = (typeof SUBSCRIPTION_CHANGE_KINDS)[number];

export const SUBSCRIPTION_CHANGE_STATUSES = ['scheduled', 'applied', 'canceled', 'failed'] as const;
export type SubscriptionChangeStatus = (typeof SUBSCRIPTION_CHANGE_STATUSES)[number];

export const SUBSCRIPTION_PROVIDERS = ['iyzico', 'manual'] as const;
export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUGGESTION_OP_STATUSES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type SuggestionOpStatus = (typeof SUGGESTION_OP_STATUSES)[number];

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUPPORT_ACCESS_SCOPES = ['case', 'conversation'] as const;
export type SupportAccessScope = (typeof SUPPORT_ACCESS_SCOPES)[number];

export const SUPPORT_TICKET_CATEGORIES = [
  'technical',
  'billing',
  'account',
  'kvkk',
  'other',
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const SUPPORT_TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

export const SUPPORT_TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'closed'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_PARAM_VALUES = ['deepseek', 'reasoning_effort', 'anthropic', 'none'] as const;
export type ThinkingParamValue = (typeof THINKING_PARAM_VALUES)[number];

export const TOOL_CALL_NAMES = [
  'search_decisions',
  'get_decision',
  'search_legislation',
  'get_legislation_article',
  'search_case_files',
  'calculate_deadline',
  'create_document',
  'edit_document',
  'submit_outline',
  'submit_result',
] as const;
export type ToolCallName = (typeof TOOL_CALL_NAMES)[number];

export const TOOL_CALL_STATUSES = ['success', 'error', 'not_enabled', 'timeout'] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const TOOL_SETS = [
  'chat_tools',
  'submit_outline',
  'edit_document',
  'submit_result',
  'none',
] as const;
export type ToolSet = (typeof TOOL_SETS)[number];

export const TRANSFER_BASES = ['none', 'domestic', 'scc_pending', 'scc_notified'] as const;
export type TransferBasis = (typeof TRANSFER_BASES)[number];

export const USAGE_SOURCES = ['provider', 'estimated'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export const USER_SUSPEND_REASONS = [
  'abuse',
  'security',
  'verification_mismatch',
  'legal_request',
  'user_request',
  'other',
] as const;
export type UserSuspendReason = (typeof USER_SUSPEND_REASONS)[number];

export const VERIFICATION_SOURCES = ['admin_review', 'org_invitation'] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const VERIFICATION_STATUSES = [
  'pending_verification',
  'verified',
  'rejected',
  'suspended',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
