// RLS manifesti (031 §14): her `app` tablosunun sınıfı, beklenen politika adları, rol başı tablo/kolon
// yetkileri, `eda_jobs` kolonları (`jobsColumns`, 031 §11) ve içerik kolonları. Tek kaynaktır:
// (a) migrate denetim parametreleri (k_tables, content_columns, definer_write_grants; src/migrate/audit.ts),
// (b) test/rls/manifest.test.ts canlı `pg_policy` ve ACL'lerle birebir karşılaştırır (KK-031-14),
// (c) `rls` migrasyonlarındaki GRANT deyimleri `grantStatements()` ile üretilir (scripts/gen-rls-grants.ts).
// Hassas yol: değişiklik CODEOWNERS iki onayına tabidir (031 §7 madde 6).
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as ai from '../schema/app/ai.ts';
import * as billing from '../schema/app/billing.ts';
import * as calendar from '../schema/app/calendar.ts';
import * as legalCase from '../schema/app/case.ts';
import * as catalog from '../schema/app/catalog.ts';
import * as chat from '../schema/app/chat.ts';
import * as document from '../schema/app/document.ts';
import * as org from '../schema/app/org.ts';
import * as partners from '../schema/app/partners.ts';
import * as platform from '../schema/app/platform.ts';
import * as userLimits from '../schema/app/user-limits.ts';

export const TABLE_CLASSES = ['tenant', 'user', 'catalog', 'none'] as const;
export type TableClass = (typeof TABLE_CLASSES)[number];

/** Yetkisi manifestte izlenen roller (sahip `eda_owner` hariç). */
export const GRANTEE_ROLES = [
  'eda_app',
  'eda_worker',
  'eda_jobs',
  'eda_readonly_admin',
  'eda_rls_helper',
  'eda_sec_definer',
] as const;
export type GranteeRole = (typeof GRANTEE_ROLES)[number];

export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
export type ColumnPrivilege = 'SELECT' | 'INSERT' | 'UPDATE';

/** Tablo düzeyi (`table`) ve kolon düzeyi (`select`/`insert`/`update`) yetkiler. */
export interface RoleGrant {
  readonly table?: readonly TablePrivilege[];
  readonly select?: readonly string[];
  readonly insert?: readonly string[];
  readonly update?: readonly string[];
  /** Kolon listesi verilmeden tablo DELETE yetkisi (yalnız `eda_jobs`). */
  readonly delete?: boolean;
}

export interface TableManifest {
  readonly class: TableClass;
  /** Beklenen politika adları (tam ad: `<tablo>_<ek>`). */
  readonly policies: readonly string[];
  /** `eda_jobs` dışındaki rollerin yetkileri. */
  readonly grants: Partial<Record<Exclude<GranteeRole, 'eda_jobs'>, RoleGrant>>;
  /** `eda_jobs` kolon yetkileri (031 §11): içerik kolonu YOK, tablo düzeyi SELECT YOK. */
  readonly jobsColumns?: RoleGrant;
  /** Aylık RANGE bölümlü ekli tablo (030 §1.6). */
  readonly partitioned?: boolean;
}

/** 031 §13 başlangıç listesi + 030 kolon adlarıyla kesinleşen içerik kolonları (Q10). */
export const CONTENT_COLUMNS = [
  'parts',
  'llm_parts',
  'llm_context',
  'reasoning',
  'content',
  'text',
  'body',
  'title',
  'name',
  'display_name',
  'query',
  'snippet',
  'outline',
  'ops',
  'metadata_text',
  'tckn_enc',
  'vkn_enc',
  'address',
  'phone',
  'email',
  'notes',
  // 030 kolon adlarıyla eklenenler (mesleki sır / kimlik sınıfı, 030 §14.1):
  'first_name',
  'last_name',
  'entity_name',
  'aliases',
  'original_name',
  'name_fold',
  'title_fold',
  'short_name',
  'esas_no',
  'karar_no',
  'counsel_name',
  'summary',
  'draft',
  'kunye_snapshot',
  'raw',
  'quote',
  'parsed',
  'results',
  'filters',
  'overview',
  'card',
  'hidden_content_report',
  'text_norm',
  'masked_content',
  'evidence_quote',
  'calculation',
  'location',
  'subject',
  'description',
  'scope_note',
  'notary_name',
  'yevmiye_no',
  'letterhead',
  'ai_instructions',
  'signature_block',
  'corrections',
  'checklist',
  'legal_name',
  'address_line',
  'tax_id_enc',
  'buyer_tax_id_enc',
  'billing_snapshot',
  'invoice_email',
  'rejection_reason',
  'params',
  'sealed_params',
  'auth_secret',
  'p256dh',
  'endpoint',
  'decision',
] as const;

/** Tüm kolonlar (Drizzle şemasından açılır). */
const ALL: readonly string[] = ['*'];

const S: TablePrivilege = 'SELECT';
const I: TablePrivilege = 'INSERT';
const U: TablePrivilege = 'UPDATE';
const D: TablePrivilege = 'DELETE';

/** E tablosu politika adları: kapı + komutlar. */
const tenantPolicies = (...cmds: ('select' | 'insert' | 'update' | 'delete')[]) => [
  'tenant_guard',
  ...cmds,
];

/** Kimlik + `org_id` + imha; büro kapsamlı içerik tablolarında `org.purge` için (031 §11). */
const purge = (extra: readonly string[] = [], more: Omit<RoleGrant, 'select'> = {}): RoleGrant => ({
  select: ['id', 'org_id', ...extra],
  delete: true,
  ...more,
});

const RAW: Readonly<Record<string, Omit<TableManifest, 'policies'> & { policies: string[] }>> = {
  // ---------- 030 §4 kimlik, büro, bayi ----------
  lawyer_profiles: {
    class: 'user',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: {
        table: [S],
        insert: ['user_id', 'baro', 'sicil_no', 'trainee_registry_no', 'ai_instructions'],
        update: ['baro', 'sicil_no', 'trainee_registry_no', 'ai_instructions', 'submitted_at'],
      },
      // app.admin_decide_application (0028): inceleme alanları; app.mark_profile_invitation_source
      // (0030): davetle meslek profili kaynağı.
      eda_sec_definer: {
        // P27 (0037): başvuru kuyruğu okuması (baro, sicil, ret nedeni, başvuru zamanı).
        select: [
          'user_id',
          'baro',
          'sicil_no',
          'trainee_registry_no',
          'verification_source',
          'reviewed_at',
          'rejection_reason',
          'submitted_at',
        ],
        update: ['verification_source', 'reviewed_by', 'reviewed_at', 'rejection_reason'],
      },
    },
  },
  org_settings: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S, I, U] },
      eda_rls_helper: { select: ['org_id', 'trainee_supervision'] },
      // app.admin_ai_key_org_* (0047): şifreli anahtar yalnız YAZILIR (enc sütununa SELECT yok).
      eda_sec_definer: {
        select: ['org_id', 'ai_api_key_last4', 'ai_api_key_verified_at'],
        update: [
          'ai_api_key_enc',
          'ai_api_key_last4',
          'ai_api_key_version',
          'ai_api_key_verified_at',
          'updated_by',
        ],
      },
    },
    jobsColumns: {
      select: ['org_id', 'legal_hold', 'retention_years_after_mandate', 'updated_at'],
      delete: true,
    },
  },
  org_keys: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: {
      eda_app: { table: [S, I] },
      // app.admin_ai_key_org_dek (0047): sarılı DEK (KEK olmadan işe yaramaz); API anahtarı şifreler.
      eda_sec_definer: {
        select: ['org_id', 'wrapped_dek', 'key_version', 'kek_version', 'status'],
      },
    },
    jobsColumns: purge(
      ['key_version', 'kek_version', 'status', 'created_at', 'retired_at', 'shredded_at'],
      {
        update: ['status', 'wrapped_dek', 'retired_at', 'shredded_at'],
      },
    ),
  },
  partners: {
    class: 'catalog',
    policies: [],
    grants: { eda_sec_definer: { select: ['code', 'is_active'] } },
    jobsColumns: { select: ['id', 'code', 'is_active'] },
  },
  partner_members: {
    class: 'none',
    policies: [],
    grants: { eda_sec_definer: { select: ['user_id'] } },
  },
  partner_organizations: { class: 'none', policies: [], grants: {} },
  user_preferences: {
    class: 'user',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S, I, U] },
      // app.admin_ai_key_user_* (0047): şifreli anahtar yalnız YAZILIR (enc sütununa SELECT yok).
      eda_sec_definer: {
        select: ['user_id', 'ai_key_source', 'ai_api_key_last4', 'ai_api_key_verified_at'],
        insert: ['user_id'],
        update: [
          'ai_key_source',
          'ai_api_key_enc',
          'ai_api_key_last4',
          'ai_api_key_version',
          'ai_api_key_verified_at',
        ],
      },
    },
  },
  // Kullanıcı bazlı limit geçersiz kılmaları (0038): kişi kendi satırını okur; yazma yalnız
  // app.admin_set_user_limits (eda_sec_definer) ile.
  user_limit_overrides: {
    class: 'user',
    policies: tenantPolicies('select'),
    grants: {
      eda_app: { table: [S] },
      eda_sec_definer: {
        select: ALL,
        insert: [
          'user_id',
          'chat_turns_per_day',
          'chat_turns_per_month',
          'tokens_per_day',
          'tokens_per_month',
          'updated_by',
        ],
        update: [
          'chat_turns_per_day',
          'chat_turns_per_month',
          'tokens_per_day',
          'tokens_per_month',
          'updated_by',
        ],
        delete: true,
      },
    },
  },

  // ---------- 030 §5 kataloglar ----------
  courts: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  chambers: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  case_types: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  deadline_rules: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  holidays: {
    class: 'catalog',
    policies: [],
    grants: { eda_app: { table: [S] } },
    jobsColumns: { select: ['id', 'holiday_date', 'code', 'kind', 'is_half_day', 'verified_at'] },
  },
  judicial_recesses: {
    class: 'catalog',
    policies: [],
    grants: { eda_app: { table: [S] } },
    jobsColumns: { select: ['id', 'branch', 'year', 'period', 'verified_at'] },
  },

  // ---------- 030 §6 müvekkil, dava, evrak ----------
  clients: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge(['created_at', 'updated_at']),
  },
  powers_of_attorney: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge(['client_id', 'ended_at', 'created_at']),
  },
  cases: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S, I, U] },
      eda_rls_helper: { select: ['id', 'org_id', 'visibility', 'created_by'] },
      eda_sec_definer: { select: ['id', 'org_id', 'visibility', 'created_by'] },
    },
    jobsColumns: purge([
      'status',
      'visibility',
      'legal_hold',
      'mandate_ended_at',
      'created_at',
      'updated_at',
    ]),
  },
  case_members: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'delete'),
    grants: {
      eda_app: { table: [S, I, D] },
      eda_rls_helper: { select: ['case_id', 'user_id'] },
      eda_sec_definer: {
        select: ['org_id', 'case_id', 'user_id'],
        insert: ['org_id', 'case_id', 'user_id', 'added_by'],
      },
    },
    jobsColumns: purge(['case_id', 'user_id']),
  },
  case_parties: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge(['case_id']),
  },
  files: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge([
      'case_id',
      'origin',
      'status',
      'size_bytes',
      'object_key',
      'scanned_at',
      'ready_at',
      'inbox_expires_at',
      'delete_requested_at',
      'created_at',
      'updated_at',
    ]),
  },
  file_texts: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
  },
  file_chunks: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
  },
  custody_events: {
    class: 'tenant',
    partitioned: true,
    // insert_system (0046): worker'ın `actor_type = 'system'` `delete` olayı; kullanıcıya atfedilmez.
    policies: [...tenantPolicies('select', 'insert'), 'insert_system'],
    grants: { eda_app: { table: [S, I] } },
  },
  case_ai_logs: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: { eda_app: { table: [S, I] } },
    jobsColumns: purge(['case_id', 'created_at']),
  },
  pending_file_jobs: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge(['file_id', 'queue', 'job_name', 'priority', 'created_at'], {
      update: ['priority'],
    }),
  },

  // ---------- 030 §7 sohbet, atıf, arama ----------
  conversations: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: {
      eda_app: { table: [S, I, U, D] },
      // created_at: app.admin_stats_daily (0037; yalnız gün başına sayaç).
      eda_sec_definer: {
        select: ['id', 'org_id', 'user_id', 'case_id', 'created_at'],
        update: ['user_id'],
      },
    },
    jobsColumns: purge([
      'user_id',
      'case_id',
      'data_class',
      'last_message_at',
      'archived_at',
      'created_at',
      'updated_at',
    ]),
  },
  messages: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S, I, U] },
      // app.admin_overview / admin_stats_daily (0037): tur ve aktif kullanıcı sayacı (içerik yok).
      // model_alias, completed_at: app.admin_chat_report_* (0045; takma ad ve tur süresi sayacı).
      eda_sec_definer: {
        select: [
          'id',
          'org_id',
          'role',
          'user_id',
          'status',
          'error_code',
          'created_at',
          'model_alias',
          'completed_at',
        ],
      },
    },
    jobsColumns: {
      select: [
        'id',
        'org_id',
        'conversation_id',
        'role',
        'status',
        'model_alias',
        'provider_id',
        'data_class',
        'created_at',
        'updated_at',
        'completed_at',
      ],
      update: ['reasoning'],
    },
  },
  message_sources: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: {
      eda_app: { table: [S, I] },
      // app.admin_chat_report_* (0045): kaynak türü sayacı (künye/içerik kolonu YOK).
      eda_sec_definer: { select: ['org_id', 'source_kind', 'origin', 'created_at'] },
    },
  },
  message_citations: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: {
      select: [
        'id',
        'org_id',
        'conversation_id',
        'message_id',
        'document_id',
        'status',
        'check_attempts',
        'last_checked_at',
        'created_at',
        'updated_at',
      ],
    },
  },
  message_feedback: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: {
      eda_app: { table: [S, I, U, D] },
      // app.admin_chat_report_* (0045): beğeni sayacı ve kategori kodu (kullanıcı/mesaj kimliği YOK).
      eda_sec_definer: { select: ['org_id', 'rating', 'category', 'created_at'] },
    },
  },
  feedback_shares: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: { eda_app: { table: [S, I] } },
    jobsColumns: purge(['expires_at', 'created_at']),
  },
  prompt_library: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: {
      eda_app: { table: [S, I, U, D] },
      eda_sec_definer: {
        select: ['id', 'org_id', 'scope', 'owner_user_id'],
        update: ['owner_user_id'],
      },
    },
    jobsColumns: purge(['scope', 'owner_user_id']),
  },
  decision_searches: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'delete'),
    grants: { eda_app: { table: [S, I, D] } },
    jobsColumns: purge(['user_id', 'expires_at', 'created_at']),
  },
  kunye_checks: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge([
      'user_id',
      'status',
      'expires_at',
      'completed_at',
      'created_at',
      'updated_at',
    ]),
  },

  // ---------- 030 §8 belge ----------
  templates: {
    class: 'tenant',
    policies: [...tenantPolicies('select', 'insert', 'update', 'delete'), 'platform_seed'],
    grants: {
      eda_app: { table: [S, I, U, D] },
      // app.admin_document_templates (0043): platform şablon envanteri; başlık ve gövde YOK.
      eda_sec_definer: {
        select: ['id', 'org_id', 'kind', 'case_type_code', 'version', 'is_active', 'updated_at'],
      },
    },
    jobsColumns: purge(),
  },
  documents: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: {
      eda_app: { table: [S, I, U, D] },
      // kind, created_at: app.admin_stats_* (0037; yalnız sayaç).
      eda_sec_definer: {
        select: ['id', 'org_id', 'owner_id', 'case_id', 'kind', 'created_at'],
        update: ['owner_id'],
      },
    },
    jobsColumns: purge(['owner_id', 'case_id', 'status', 'created_at', 'updated_at']),
  },
  document_versions: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    // Sürüm değişmezdir; yalnız `name` güncellenir (P17b, 054 §8.2).
    grants: { eda_app: { table: [S, I], update: ['name'] } },
  },
  document_suggestions: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
  },
  document_exports: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge([
      'subject_type',
      'status',
      'object_key',
      'size_bytes',
      'expires_at',
      'completed_at',
      'created_at',
    ]),
  },

  // ---------- 030 §9 takvim, süre, bildirim ----------
  deadlines: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge(['case_id', 'status', 'due_date', 'due_at', 'approved_by', 'created_at']),
  },
  calendar_events: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: {
      eda_app: { table: [S, I, U, D] },
      // type, created_at: app.admin_stats_* (0037; yalnız sayaç).
      eda_sec_definer: {
        select: ['id', 'org_id', 'user_id', 'case_id', 'type', 'created_at'],
        update: ['user_id'],
      },
    },
    jobsColumns: purge([
      'user_id',
      'case_id',
      'deadline_id',
      'starts_at',
      'ends_at',
      'completed_at',
      'cancelled_at',
      'created_at',
    ]),
  },
  reminders: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
    jobsColumns: purge(
      [
        'user_id',
        'calendar_event_id',
        'deadline_id',
        'remind_at',
        'channel',
        'status',
        'attempts',
        'sent_at',
        'created_at',
      ],
      { update: ['status', 'attempts', 'sent_at', 'last_error_code'] },
    ),
  },
  push_subscriptions: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'delete'),
    grants: { eda_app: { table: [S, I, D] } },
    jobsColumns: purge(['user_id', 'disabled_at', 'created_at']),
  },
  notifications: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S], update: ['read_at'] },
      eda_worker: { table: [I] },
      // app.admin_decide_application (0028): verification_approved | verification_rejected.
      // app.admin_notification_summary (0040): tür başına gönderilen/okunan sayısı (alıcı satırı yok).
      eda_sec_definer: {
        select: ['type', 'read_at', 'created_at'],
        insert: ['org_id', 'user_id', 'type', 'payload'],
      },
    },
    jobsColumns: purge(['user_id', 'type', 'read_at', 'created_at']),
  },
  notification_preferences: {
    class: 'user',
    policies: tenantPolicies('select', 'insert', 'update', 'delete'),
    grants: { eda_app: { table: [S, I, U, D] } },
  },

  // ---------- 030 §10 AI işletimi ----------
  ai_providers: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_app: { table: [S] },
      // app.admin_ai_providers (0041): yönetim paneli salt okur katalog görünümü (içerik kolonu yok).
      eda_sec_definer: {
        select: [
          'id',
          'kind',
          'region',
          'transfer_basis',
          'allowed_data_classes',
          'secret_ref',
          'training_use',
          'human_review',
          'retention_days',
          'enabled',
          'priority',
        ],
      },
    },
  },
  ai_models: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_app: { table: [S] },
      // app.admin_ai_models / admin_set_ai_model_enabled (0041): yalnız `enabled` yazılır.
      eda_sec_definer: {
        select: [
          'id',
          'alias',
          'provider_id',
          'label',
          'thinking',
          'max_output_tokens',
          'context_budget',
          'capabilities',
          'priority',
          'enabled',
          'eval_gate_passed_at',
        ],
        update: ['enabled', 'updated_at'],
      },
    },
  },
  ai_task_routes: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  prompt_versions: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  eval_runs: { class: 'catalog', policies: [], grants: {} },
  ai_usage: {
    class: 'tenant',
    partitioned: true,
    policies: tenantPolicies('select', 'insert'),
    grants: {
      eda_app: { table: [S, I] },
      // app.admin_overview / admin_stats_* (0037): maliyet ve çağrı sayaçları (içerik yok).
      eda_sec_definer: { table: [S] },
    },
    jobsColumns: { select: ALL },
  },
  tool_calls: {
    class: 'tenant',
    policies: tenantPolicies('insert'),
    grants: {
      eda_app: { table: [I] },
      // app.admin_chat_report_* (0045): araç adı, durum ve süre sayacı (argüman/içerik yok).
      eda_sec_definer: { select: ['org_id', 'tool_name', 'status', 'duration_ms', 'created_at'] },
    },
    jobsColumns: { select: ALL, delete: true },
  },
  // Platform ortak anahtarı sayaç kaydı (0047): içerik yok; kullanıcı kendi satırını okur/ekler.
  platform_key_usage: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: {
      eda_app: { table: [S, I] },
      // app.admin_ai_platform_card, app.platform_key_usage_today (0047): yalnız sayaç ve maliyet.
      // app.platform_key_reserve / platform_key_settle (0050): atomik rezervasyon ve kapanış (yazma yalnız
      // bu fonksiyonlarla; tur durumu ve sayaçlar).
      eda_sec_definer: {
        select: [
          'id',
          'org_id',
          'user_id',
          'input_tokens',
          'output_tokens',
          'cost_micro_usd',
          'status',
          'reservation',
          'created_at',
        ],
        insert: [
          'org_id',
          'user_id',
          'conversation_id',
          'model_alias',
          'cost_micro_usd',
          'status',
          'reservation',
          'request_id',
        ],
        update: ['input_tokens', 'output_tokens', 'cost_micro_usd', 'status', 'reservation'],
      },
    },
    jobsColumns: purge(),
  },
  // Platform ayarı (0049): tek satır; uygulama rolleri erişemez (RESTRICTIVE reddet-hepsi).
  // Şifreli anahtar yalnız app.platform_settings_runtime() ile okunur; yazma app.admin_platform_* ile.
  platform_settings: {
    class: 'tenant',
    policies: tenantPolicies(),
    grants: {
      eda_sec_definer: {
        select: [
          'id',
          'key_enc',
          'key_version',
          'key_label',
          'key_last4',
          'key_verified_at',
          'fallback_enabled',
          'user_turns_per_day',
          'user_tokens_per_day',
          'org_daily_cap_micro_usd',
          'platform_daily_cap_micro_usd',
          'updated_at',
        ],
        update: [
          'key_enc',
          'key_version',
          'key_label',
          'key_last4',
          'key_verified_at',
          'fallback_enabled',
          'user_turns_per_day',
          'user_tokens_per_day',
          'org_daily_cap_micro_usd',
          'platform_daily_cap_micro_usd',
          'updated_by',
        ],
      },
    },
  },
  ai_policy_acceptances: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert'),
    grants: { eda_app: { table: [S, I] } },
    jobsColumns: purge(['kind', 'accepted_at', 'revoked_at']),
  },

  // ---------- 030 §11 ticari + 046 §11.1 ----------
  plans: {
    class: 'catalog',
    policies: [],
    // app.enforce_seat_limit, app.org_seat_usage (0029, 0030): koltuk üst sınırı.
    grants: { eda_app: { table: [S] }, eda_sec_definer: { select: ['code', 'seat_max'] } },
  },
  provider_plan_refs: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  coupons: { class: 'catalog', policies: [], grants: {} },
  subscriptions: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: {
      eda_app: { table: [S] },
      // app.admin_decide_application (0028): meslek onayında deneme aboneliği (046 §3);
      // app.enforce_seat_limit (0029): koltuk kapasitesi ve `FOR UPDATE` kilidi (UPDATE yalnız kilit
      // yetkisi içindir, satır güncellenmez); app.org_seat_usage (0030).
      eda_sec_definer: {
        select: ['id', 'org_id', 'plan_code', 'status', 'seats', 'created_at'],
        update: ['updated_at'],
        insert: [
          'org_id',
          'plan_code',
          'status',
          'provider',
          'seats',
          'trial_ends_at',
          'current_period_start',
          'current_period_end',
        ],
      },
    },
    jobsColumns: purge([
      'plan_code',
      'status',
      'billing_period',
      'seats',
      'trial_ends_at',
      'current_period_start',
      'current_period_end',
      'cancel_at_period_end',
      'canceled_at',
      'past_due_since',
      'coupon_ends_at',
      'created_at',
      'updated_at',
    ]),
  },
  credit_ledger: {
    class: 'tenant',
    partitioned: true,
    policies: tenantPolicies('select', 'insert'),
    grants: {
      eda_app: { table: [S, I] },
      // app.admin_decide_application (0028): `trial_grant` (046 §5).
      eda_sec_definer: {
        select: ['id', 'org_id', 'balance_after', 'created_at'],
        insert: [
          'org_id',
          'entry_type',
          'amount',
          'balance_after',
          'user_id',
          'subscription_id',
          'expires_at',
          'created_by',
        ],
      },
    },
    jobsColumns: { select: ALL },
  },
  credit_reservations: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge(
      [
        'user_id',
        'op_code',
        'credits',
        'status',
        'expires_at',
        'settled_at',
        'created_at',
        'updated_at',
      ],
      { update: ['status'] },
    ),
  },
  invoices: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
  },
  payments: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
    jobsColumns: {
      select: [
        'id',
        'org_id',
        'invoice_id',
        'subscription_id',
        'provider',
        'status',
        'amount_kurus',
        'currency',
        'occurred_at',
        'created_at',
      ],
    },
  },
  coupon_redemptions: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
    jobsColumns: purge(['coupon_id', 'subscription_id', 'created_at']),
  },
  partner_commissions: { class: 'none', policies: [], grants: {} },
  billing_profiles: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: { select: ['org_id'], delete: true },
  },
  billing_checkouts: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
    jobsColumns: purge(['status', 'created_at', 'updated_at']),
  },
  billing_events: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
  },
  subscription_changes: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
    jobsColumns: purge(['subscription_id', 'kind', 'effective_at', 'status', 'created_at']),
  },

  // ---------- 030 §12 platform, denetim, rollup + 045 §13.2 ----------
  audit_log: {
    class: 'tenant',
    partitioned: true,
    policies: tenantPolicies('select'),
    grants: {
      eda_app: { table: [S] },
      // app.admin_audit_list / admin_audit_error_summary (0044): ip_trunc ve request_id HARİÇ.
      eda_sec_definer: {
        select: [
          'id',
          'org_id',
          'actor_type',
          'actor_id',
          'action',
          'target_type',
          'target_id',
          'metadata',
          'created_at',
        ],
        insert: [
          'org_id',
          'actor_type',
          'actor_id',
          'action',
          'target_type',
          'target_id',
          'ip_trunc',
          'metadata',
        ],
      },
    },
    jobsColumns: { select: ALL },
  },
  audit_seals: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_sec_definer: {
        select: [
          'id',
          'chain_key',
          'org_id',
          'period_start',
          'period_end',
          'row_count',
          'merkle_root',
          'prev_seal_hash',
          'seal_hash',
          'published_object_key',
          'published_at',
        ],
      },
    },
    jobsColumns: {
      select: ALL,
      insert: ALL,
      update: ['published_object_key', 'published_at'],
    },
  },
  deletion_log: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_sec_definer: {
        select: ['table_name', 'row_id'],
        insert: ['table_name', 'row_id', 'org_id', 'reason'],
      },
    },
    jobsColumns: {
      select: ALL,
      insert: ['table_name', 'row_id', 'org_id', 'reason', 'deleted_at'],
      update: ['exported_at'],
    },
  },
  announcements: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_app: { table: [S] },
      // app.admin_*_announcement (0040): yönetim yazması ve listesi (platform yazısı, kullanıcı içeriği değil).
      eda_sec_definer: {
        select: [
          'id',
          'severity',
          'audience',
          'title',
          'body',
          'active_during',
          'created_at',
          'updated_at',
        ],
        insert: ['severity', 'audience', 'title', 'body', 'active_during', 'created_by'],
        update: ['severity', 'audience', 'title', 'body', 'active_during'],
      },
    },
  },
  feature_flags: { class: 'catalog', policies: [], grants: { eda_app: { table: [S] } } },
  system_settings: {
    class: 'catalog',
    policies: [],
    grants: {
      eda_app: { table: [S] },
      // app.admin_limit_platform_values (0039): limit ekranı etkin platform değerleri.
      eda_sec_definer: { select: ['key', 'value'] },
    },
  },
  // Büro bazlı limit geçersiz kılma (0039): eda_app yalnız okur; yazma app.admin_org_limit_set/clear.
  org_limit_overrides: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: {
      eda_app: { table: [S] },
      eda_sec_definer: {
        select: ['org_id', 'key', 'value', 'updated_at'],
        insert: ['org_id', 'key', 'value', 'updated_by'],
        update: ['value', 'updated_by', 'updated_at'],
        delete: true,
      },
    },
    jobsColumns: { select: ['org_id', 'key'], delete: true },
  },
  support_tickets: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: {
      eda_app: { table: [S, I, U] },
      // app.admin_list_support_tickets / admin_set_support_ticket_status (0043): konu ve gövde YOK.
      eda_sec_definer: {
        select: [
          'id',
          'org_id',
          'user_id',
          'category',
          'priority',
          'status',
          'closed_at',
          'created_at',
          'updated_at',
        ],
        update: ['status', 'closed_at', 'updated_at'],
      },
    },
    jobsColumns: purge(['user_id', 'status', 'closed_at', 'created_at', 'updated_at']),
  },
  org_closures: {
    class: 'tenant',
    policies: tenantPolicies('select'),
    grants: { eda_app: { table: [S] } },
    jobsColumns: {
      select: [
        'id',
        'org_id',
        'phase',
        'mode',
        'requested_at',
        'return_until',
        'frozen_at',
        'delete_after',
        'deleting_started_at',
        'deleted_at',
        'cancelled_at',
        'export_ids',
        'export_verified_at',
        'return_confirmed_at',
        'blocked_reason',
      ],
      update: [
        'phase',
        'frozen_at',
        'delete_after',
        'deleting_started_at',
        'deleted_at',
        'cancelled_at',
        'export_verified_at',
        'blocked_reason',
      ],
    },
  },
  kvkk_requests: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge(
      [
        'requester_user_id',
        'request_type',
        'status',
        'scope',
        'due_at',
        'completed_at',
        'created_at',
        'updated_at',
      ],
      { update: ['status', 'completed_at'] },
    ),
  },
  product_events: {
    class: 'tenant',
    policies: tenantPolicies('insert'),
    grants: { eda_app: { table: [I] } },
    jobsColumns: { select: ALL, delete: true },
  },
  support_access_grants: {
    class: 'tenant',
    policies: tenantPolicies('select', 'insert', 'update'),
    grants: { eda_app: { table: [S, I, U] } },
    jobsColumns: purge(['expires_at', 'created_at']),
  },
  email_deliveries: {
    class: 'tenant',
    policies: tenantPolicies('select', 'update'),
    grants: {
      eda_worker: {
        select: [
          'id',
          'org_id',
          'user_id',
          'invitation_id',
          'kind',
          'template_code',
          'template_version',
          'class',
          'dedupe_key',
          'params',
          'sealed_params',
          'expires_at',
          'status',
          'attempts',
          'created_at',
        ],
        update: [
          'status',
          'attempts',
          'provider_message_id',
          'error_code',
          'sent_at',
          'sealed_params',
        ],
      },
      // app.email_enqueue (0026): tek yazma yolu; app.email_delivery_route yönlendirme okuması.
      // app.admin_audit_error_summary (0044): başarısız teslim sayacı (şablon kodu + durum + zaman).
      eda_sec_definer: {
        select: ['id', 'org_id', 'user_id', 'dedupe_key', 'status', 'template_code', 'created_at'],
        insert: [
          'id',
          'org_id',
          'user_id',
          'invitation_id',
          'kind',
          'template_code',
          'template_version',
          'class',
          'dedupe_key',
          'params',
          'sealed_params',
          'expires_at',
        ],
      },
    },
    jobsColumns: purge(
      [
        'user_id',
        'kind',
        'template_code',
        'class',
        'status',
        'attempts',
        'expires_at',
        'created_at',
        'updated_at',
      ],
      { update: ['status', 'sealed_params'] },
    ),
  },
  admin_rollup_usage_daily: rollup(),
  // app.admin_list_orgs (0023; 031 §8.2) son gün satırını okur.
  admin_rollup_orgs_daily: rollup({ select: ALL }),
  admin_rollup_sources_hourly: rollup(),
  admin_rollup_product_daily: rollup(),
  partner_rollup_monthly: rollup(),
};

function rollup(definer?: RoleGrant): Omit<TableManifest, 'policies'> & { policies: string[] } {
  return {
    class: 'catalog',
    policies: [],
    grants: {
      eda_readonly_admin: { table: [S] },
      ...(definer !== undefined ? { eda_sec_definer: definer } : {}),
    },
    jobsColumns: {
      select: ALL,
      insert: ALL,
      update: ALL,
    },
  };
}

// ---------- türetme ----------

const APP_MODULES = [
  ai,
  billing,
  calendar,
  legalCase,
  catalog,
  chat,
  document,
  org,
  partners,
  platform,
  userLimits,
];

const APP_TABLES: ReadonlyMap<string, PgTable> = new Map(
  APP_MODULES.flatMap((m) => Object.values(m) as unknown[])
    .filter((v): v is PgTable => {
      try {
        return getTableConfig(v as PgTable).schema === 'app';
      } catch {
        return false;
      }
    })
    .map((t) => [getTableConfig(t).name, t]),
);

/** Drizzle şemasındaki kolon adları (tanım sırası). */
export function tableColumns(table: string): string[] {
  const t = APP_TABLES.get(table);
  if (t === undefined) throw new Error(`manifest: Drizzle şemasında olmayan tablo: app.${table}`);
  return getTableConfig(t).columns.map((c) => c.name);
}

const expand = (
  table: string,
  cols: readonly string[] | undefined,
): readonly string[] | undefined => (cols?.[0] === '*' ? tableColumns(table) : cols);

function resolve(table: string, g: RoleGrant | undefined): RoleGrant | undefined {
  if (g === undefined) return undefined;
  const out: { -readonly [K in keyof RoleGrant]: RoleGrant[K] } = { ...g };
  const sel = expand(table, g.select);
  const ins = expand(table, g.insert);
  const upd = expand(table, g.update);
  if (sel !== undefined) out.select = sel;
  if (ins !== undefined) out.insert = ins;
  if (upd !== undefined) out.update = upd;
  return out;
}

/** Tam manifest: politika adları `<tablo>_<ek>`, `ALL` kolon listeleri açılmış. */
export const RLS_MANIFEST: Readonly<Record<string, TableManifest>> = Object.fromEntries(
  Object.entries(RAW).map(([table, m]) => {
    const grants: TableManifest['grants'] = Object.fromEntries(
      Object.entries(m.grants).map(([role, g]) => [role, resolve(table, g)]),
    );
    const jobs = resolve(table, m.jobsColumns);
    const entry: TableManifest = {
      class: m.class,
      policies: m.policies.map((p) => `${table}_${p}`),
      grants,
      ...(jobs !== undefined ? { jobsColumns: jobs } : {}),
      ...(m.partitioned ? { partitioned: true } : {}),
    };
    return [table, entry];
  }),
);

export const MANIFEST_TABLES: readonly string[] = Object.keys(RLS_MANIFEST).sort();

/** K ve "—" tabloları (RLS'siz `app` tabloları; Q1–Q4 `k_tables`). */
export const K_TABLES: readonly string[] = MANIFEST_TABLES.filter((t) => {
  const c = RLS_MANIFEST[t]?.class;
  return c === 'catalog' || c === 'none';
});

/** RLS'li tablolar (E: kiracı veya kullanıcı kapsamlı). */
export const RLS_TABLES: readonly string[] = MANIFEST_TABLES.filter((t) => !K_TABLES.includes(t));

/** Bölümlü ekli tablolar (030 §1.6). */
export const PARTITIONED_TABLES: readonly string[] = MANIFEST_TABLES.filter(
  (t) => RLS_MANIFEST[t]?.partitioned === true,
);

/** Bir tablonun içerik kolonları (CONTENT_COLUMNS ∩ tablo kolonları). */
export function contentColumnsOf(table: string): string[] {
  const set = new Set<string>(CONTENT_COLUMNS);
  return tableColumns(table).filter((c) => set.has(c));
}

/** Rol başı tüm yetkiler (`eda_jobs` dahil). */
export function grantsOf(table: string): Partial<Record<GranteeRole, RoleGrant>> {
  const m = RLS_MANIFEST[table];
  if (m === undefined) throw new Error(`manifest: tanımsız tablo: app.${table}`);
  return { ...m.grants, ...(m.jobsColumns !== undefined ? { eda_jobs: m.jobsColumns } : {}) };
}

/**
 * `auth` şemasında SECURITY DEFINER sahiplerinin kalıcı yazma yetkileri (auth RLS'sizdir, manifest
 * tabloları yalnız `app`'tir): `app.admin_decide_application` meslek doğrulama durumunu yazar
 * (031 §8.2; 0028).
 */
export const AUTH_DEFINER_WRITE_GRANTS = [
  { table: 'users', column: 'updated_at', privilege: 'UPDATE' },
  { table: 'users', column: 'verification_status', privilege: 'UPDATE' },
  // app.admin_set_user_suspended (0038): hesap askısı (Better Auth `banned` alanı).
  { table: 'users', column: 'banned', privilege: 'UPDATE' },
  { table: 'users', column: 'ban_reason', privilege: 'UPDATE' },
] as const;

/**
 * E5 parametresi: SECURITY DEFINER sahip rollerinin kalıcı yazma yetkileri, `şema.tablo.kolon.YETKİ`
 * biçiminde (032 §6.5); `auth` kalemleri `AUTH_DEFINER_WRITE_GRANTS`'tadır.
 */
export function definerWriteGrants(): string[] {
  const out: string[] = AUTH_DEFINER_WRITE_GRANTS.map(
    (g) => `auth.${g.table}.${g.column}.${g.privilege}`,
  );
  for (const table of MANIFEST_TABLES) {
    const g = grantsOf(table);
    for (const role of ['eda_sec_definer', 'eda_rls_helper'] as const) {
      const r = g[role];
      for (const c of r?.insert ?? []) out.push(`app.${table}.${c}.INSERT`);
      for (const c of r?.update ?? []) out.push(`app.${table}.${c}.UPDATE`);
    }
  }
  return out.sort();
}

const quoteCols = (cols: readonly string[]) => cols.join(', ');

/** Manifestten GRANT deyimleri (rls migrasyonlarına yapıştırılır; manifest testi canlıyla karşılaştırır). */
export function grantStatements(table: string): string[] {
  const out: string[] = [];
  const g = grantsOf(table);
  for (const role of GRANTEE_ROLES) {
    const r = g[role];
    if (r === undefined) continue;
    const privs = [...(r.table ?? []), ...(r.delete ? (['DELETE'] as const) : [])];
    if (privs.length > 0) out.push(`GRANT ${privs.join(', ')} ON app.${table} TO ${role};`);
    if (r.select?.length)
      out.push(`GRANT SELECT (${quoteCols(r.select)}) ON app.${table} TO ${role};`);
    if (r.insert?.length)
      out.push(`GRANT INSERT (${quoteCols(r.insert)}) ON app.${table} TO ${role};`);
    if (r.update?.length)
      out.push(`GRANT UPDATE (${quoteCols(r.update)}) ON app.${table} TO ${role};`);
  }
  return out;
}
