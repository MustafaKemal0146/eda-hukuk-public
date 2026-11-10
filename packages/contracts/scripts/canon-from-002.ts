// 002 kanonik belgesinin §7 (+§7.1) yapılandırma, §11 enum, §5 env (+§17 kuyruk), §20 hata kodu
// ve §22 denetim olayı tablolarını ayrıştırır; test/fixtures/canon-{config,enums,env,errors,
// audit-events}.json üretir.
// `--check` kipinde yazmaz, fark varsa 1 ile çıkar (KK-002-1, KK-002-3, KK-002-5, KK-002-14).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

type ConfigValue = number | string | boolean | null | readonly (number | string)[];
type ConfigEntry = { default: ConfigValue; adminEditable: boolean };
type RowSpec = {
  names: readonly string[];
  mode?: 'split' | 'capabilities' | 'evalSuites' | 'creditOpCodes' | 'skip';
};

const PKG_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(PKG_ROOT, '..', '..');
const SOURCE = join(REPO_ROOT, 'plans', '00-baslangic', '002-kanonik-degerler.md');
const FIXTURES = join(PKG_ROOT, 'test', 'fixtures');

// §11 tablo satırı etiketi (ilk hücre) -> enums.ts dizi adları. Aynı etiket ikinci kez
// geçerse `<etiket>#2` anahtarı kullanılır. Birden çok ad = değer hücresi ` / ` ile bölünür.
const ENUM_ROWS: Readonly<Record<string, RowSpec>> = {
  'Büro rolü (`members.role`)': { names: ['MEMBER_ROLES'] },
  'Platform rolü (`users.platform_role`)': { names: ['PLATFORM_ROLES'] },
  'Bayi rolü (`partner_members.role`)': { names: ['PARTNER_MEMBER_ROLES'] },
  'Üyelik durumu (`members.status`) (yeni)': { names: ['MEMBER_STATUSES'] },
  'Meslek doğrulama (`users.verification_status`) (yeni adlandırma)': {
    names: ['VERIFICATION_STATUSES'],
  },
  'Büro türü (`organizations.kind`)': { names: ['ORG_KINDS'] },
  'MFA düzeyi (`sessions.mfa_level`)': { names: ['MFA_LEVELS'] },
  'AI politika kabul türü (`ai_policy_acceptances.kind`) (yeni)': {
    names: ['AI_POLICY_ACCEPTANCE_KINDS'],
  },
  'Veri sınıfı (`data_class`)': { names: ['DATA_CLASSES'] },
  'Yerleşim (`ai_data_residency`)': { names: ['AI_DATA_RESIDENCIES'] },
  'Hassas dosya politikası (`sensitive_case_policy`)': { names: ['SENSITIVE_CASE_POLICIES'] },
  'API anahtarı kaynağı (`user_preferences.ai_key_source`) (yeni)': { names: ['AI_KEY_SOURCES'] },
  'Aktarım dayanağı (`transfer_basis`)': { names: ['TRANSFER_BASES'] },
  'Sağlayıcı türü (`ai_providers.kind`)': { names: ['AI_PROVIDER_KINDS'] },
  'Sağlayıcı kimliği (seed `ai_providers.id` slug)': { names: ['AI_PROVIDER_IDS'] },
  'Bölge (`ai_providers.region`)': { names: ['AI_PROVIDER_REGIONS'] },
  'Thinking (`ai_models.thinking`, rota) (yeni küme)': { names: ['THINKING_LEVELS'] },
  '`ai_models.capabilities` anahtarları': {
    names: ['AI_MODEL_CAPABILITY_KEYS', 'THINKING_PARAM_VALUES', 'PREFIX_CACHE_MODES'],
    mode: 'capabilities',
  },
  'Dava durumu (`cases.status`)': { names: ['CASE_STATUSES'] },
  'Görünürlük (`cases.visibility`)': { names: ['CASE_VISIBILITIES'] },
  'Hassasiyet (`cases.sensitivity`)': { names: ['CASE_SENSITIVITIES'] },
  'Müvekkil YZ onayı (`cases.client_ai_consent`)': { names: ['CLIENT_AI_CONSENTS'] },
  'Hassas konu kodları (yeni)': { names: ['SENSITIVE_TOPIC_CODES'] },
  'Müvekkil türü (`clients.kind`) (yeni)': { names: ['CLIENT_KINDS'] },
  'Taraf rolü (`case_parties.role`) (yeni)': { names: ['PARTY_ROLES'] },
  'Evrak durumu (`files.status`)': { names: ['FILE_STATUSES'] },
  'Evrak türü (`file_texts.doc_type`, Evrak Kartı) (yeni)': { names: ['FILE_DOC_TYPES'] },
  'Kabul edilen dosya türleri': { names: ['ACCEPTED_FILE_TYPES'] },
  'Delil zinciri olayı (`custody_events.event`)': { names: ['CUSTODY_EVENTS'] },
  'Belge türü (`documents.kind`)': { names: ['DOCUMENT_KINDS'] },
  'Belge durumu (`documents.status`)': { names: ['DOCUMENT_STATUSES'] },
  'Section rolü (`section.attrs.role`) — **camelCase istisnası** (TipTap)': {
    names: ['SECTION_ROLES'],
  },
  'Belge alt türü (`documents.subtype`, `templates.subtype`) (yeni)': {
    names: ['DOCUMENT_SUBTYPES'],
  },
  'Edit op türü': { names: ['EDIT_OP_TYPES'] },
  'Öneri durumu (`document_suggestions.status`) (yeni)': { names: ['SUGGESTION_STATUSES'] },
  'Sürüm kaynağı (`document_versions.source`)': { names: ['DOCUMENT_VERSION_SOURCES'] },
  'Dışa aktarım biçimi': { names: ['DOCUMENT_EXPORT_FORMATS'] },
  'Dışa aktarım durumu (`document_exports.status`) (yeni)': {
    names: ['DOCUMENT_EXPORT_STATUSES'],
  },
  'Mesaj rolü': { names: ['MESSAGE_ROLES'] },
  'Mesaj durumu (`messages.status`)': { names: ['MESSAGE_STATUSES'] },
  'Künye durumu (`message_citations.status`, `citation.attrs.status`)': {
    names: ['KUNYE_STATUSES'],
  },
  'Süre Kilidi durumu (`data-deadline-checks`) (yeni)': { names: ['DEADLINE_CHECK_STATUSES'] },
  'Kaynak türü (`message_sources.source_kind`) (yeni)': { names: ['SOURCE_KINDS'] },
  'Kaynak kökeni (`origin`)': { names: ['SOURCE_ORIGINS'] },
  'Alaka etiketi': { names: ['RELEVANCE_LABELS'] },
  'Pipeline aşaması': { names: ['PIPELINE_STAGES'] },
  'Pipeline durumu (yeni)': { names: ['PIPELINE_STATUSES'] },
  'Bildirim kodu (`data-notice.code`) (yeni küme)': { names: ['NOTICE_CODES'] },
  'Karar bölüm rolü (`corpus.decision_sections.role`) — **ASCII Türkçe istisnası**': {
    names: ['DECISION_SECTION_ROLES'],
  },
  'Etkinlik türü (`calendar_events.type`)': { names: ['CALENDAR_EVENT_TYPES'] },
  'Süre durumu (`deadlines.status`) (yeni)': { names: ['DEADLINE_STATUSES'] },
  'Yargı kolu stratejisi (`deadline_rules.branch`) (yeni)': { names: ['DEADLINE_BRANCHES'] },
  'Başlangıç olayı (yeni)': { names: ['DEADLINE_START_EVENTS'] },
  'Tebligat yöntemi (yeni)': { names: ['SERVICE_METHODS'] },
  'Süre birimi': { names: ['DEADLINE_PERIOD_UNITS'] },
  'Hatırlatıcı/bildirim kanalı (yeni)': { names: ['NOTIFICATION_CHANNELS'] },
  'Paket kodu (`plans.code`) (yeni)': { names: ['PLAN_CODES'] },
  'Abonelik durumu (yeni)': { names: ['SUBSCRIPTION_STATUSES'] },
  'Kredi hareketi (`credit_ledger.entry_type`) (yeni)': { names: ['CREDIT_ENTRY_TYPES'] },
  'Rezervasyon durumu (yeni)': { names: ['RESERVATION_STATUSES'] },
  'Kredi işlem kodu (`op_code`) (yeni)': { names: ['CREDIT_OP_CODES'], mode: 'creditOpCodes' },
  'Denetim aktör türü': { names: ['AUDIT_ACTOR_TYPES'] },
  'KVKK talep türü (yeni)': { names: ['KVKK_REQUEST_TYPES'] },
  'KVKK talep durumu (yeni)': { names: ['KVKK_REQUEST_STATUSES'] },
  'Bildirim türü (yeni)': { names: ['NOTIFICATION_TYPES'] },
  '`invitations.status`': { names: ['INVITATION_STATUSES'] },
  '`sessions.surface`': { names: ['SESSION_SURFACES'] },
  '`org_keys.status`': { names: ['ORG_KEY_STATUSES'] },
  '`lawyer_profiles.verification_source`': { names: ['VERIFICATION_SOURCES'] },
  '`partner_organizations.source`': { names: ['PARTNER_ORG_SOURCES'] },
  '`courts.court_type`': { names: ['COURT_TYPES_DB'] },
  '`chambers.chamber_kind`': { names: ['CHAMBER_KINDS'] },
  '`holidays.kind`': { names: ['HOLIDAY_KINDS'] },
  '`powers_of_attorney.scope_kind`': { names: ['POWER_OF_ATTORNEY_SCOPE_KINDS'] },
  '`corpus.*.court_type` (`CourtType`)': { names: ['SEARCH_COURT_TYPES'] },
  'MCP `LawType`': { names: ['MCP_LAW_TYPES'] },
  '`corpus.laws.law_type`': { names: ['LAW_TYPES'] },
  '`corpus.laws.status`, `law_articles.status`': { names: ['LAW_STATUSES'] },
  '`corpus.decisions.text_status`': { names: ['DECISION_TEXT_STATUSES'] },
  '`corpus.decisions.withdrawn_reason`': { names: ['DECISION_WITHDRAWN_REASONS'] },
  '`corpus.ingestion_runs.kind` / `.status`': {
    names: ['INGESTION_RUN_KINDS', 'INGESTION_RUN_STATUSES'],
  },
  '`corpus.ingestion_runs.params.phase` (yeni)': { names: ['INGESTION_PHASES'] },
  '`CorpusRejectReason`': { names: ['CORPUS_REJECT_REASONS'] },
  '`files.origin`': { names: ['FILE_ORIGINS'] },
  '`files.status_reason`': { names: ['FILE_STATUS_REASONS'] },
  '`file_texts.extraction_method` / `.card_status`': {
    names: ['EXTRACTION_METHODS', 'FILE_CARD_STATUSES'],
  },
  '`message_feedback.category`': { names: ['FEEDBACK_CATEGORIES'] },
  '`prompt_library.scope`': { names: ['PROMPT_LIBRARY_SCOPES'] },
  'İstem sürümü durumu (türetilmiş)': { names: ['PROMPT_VERSION_STATUSES'] },
  '`kunye_checks.status`': { names: ['KUNYE_CHECK_STATUSES'] },
  '`documents.generation_status`': { names: ['DOCUMENT_GENERATION_STATUSES'] },
  '`document_versions.trigger`': { names: ['DOCUMENT_VERSION_TRIGGERS'] },
  '`document_exports.subject_type`': { names: ['EXPORT_SUBJECT_TYPES'] },
  '`document_exports.data_scope`': { names: ['EXPORT_DATA_SCOPES'] },
  'Dışa aktarım biçimi#2': { names: ['EXPORT_FORMATS'] },
  '`document_suggestions.ops[].opStatus`': { names: ['SUGGESTION_OP_STATUSES'] },
  '`reminders.status`': { names: ['REMINDER_STATUSES'] },
  '`ai_usage.status`': { names: ['AI_USAGE_STATUSES'] },
  '`ai_usage.usage_source` / `.pricing_window`': { names: ['USAGE_SOURCES', 'PRICING_WINDOWS'] },
  '`ai_usage.flags`': { names: ['AI_USAGE_FLAGS'] },
  '`case_ai_logs.outcome`': { names: ['CASE_AI_LOG_OUTCOMES'] },
  '`tool_calls.status`': { names: ['TOOL_CALL_STATUSES'] },
  '`ai_task_routes.alias_source`': { names: ['ALIAS_SOURCES'] },
  '`ai_task_routes.tool_set`': { names: ['TOOL_SETS'] },
  'Görev ilkesi `classRule` (kod sabiti, DB kolonu değil)': { names: ['CLASS_RULES'] },
  '`eval_runs.suite` (atomik)': {
    names: ['EVAL_SUITES', 'EVAL_SUITE_PACKAGES'],
    mode: 'evalSuites',
  },
  '`subscriptions.billing_period` / `.provider`': {
    names: ['BILLING_PERIODS', 'SUBSCRIPTION_PROVIDERS'],
  },
  '`invoices.status` / `payments.status`': { names: ['INVOICE_STATUSES', 'PAYMENT_STATUSES'] },
  '`coupons.discount_type`': { names: ['COUPON_DISCOUNT_TYPES'] },
  '`partner_commissions.status`': { names: ['PARTNER_COMMISSION_STATUSES'] },
  '`billing_checkouts.status`': { names: ['BILLING_CHECKOUT_STATUSES'] },
  '`subscription_changes.kind`': { names: ['SUBSCRIPTION_CHANGE_KINDS'] },
  '`credit_ledger.note_code`': { names: ['NOTE_CODES'] },
  '`deletion_log.reason`': { names: ['DELETION_REASONS'] },
  '`announcements.severity` / `.audience`': {
    names: ['ANNOUNCEMENT_SEVERITIES', 'ANNOUNCEMENT_AUDIENCES'],
  },
  '`support_tickets.category`': { names: ['SUPPORT_TICKET_CATEGORIES'] },
  '`support_access_grants.scope`': { names: ['SUPPORT_ACCESS_SCOPES'] },
  '`breaker_state`': { names: ['BREAKER_STATES'] },
  '`corpus.source_status.state`': { names: ['SOURCE_STATES'] },
  '`corpus.source_canary_runs.probe` (yeni)': { names: ['SOURCE_CANARY_PROBES'] },
  '`corpus.source_canary_runs.outcome` (yeni)': { names: ['SOURCE_CANARY_OUTCOMES'] },
  '`product_events.event_name`': { names: ['PRODUCT_EVENT_NAMES'] },
  'Ürün metrik kodları (`admin_rollup_product_daily.metric`)': {
    names: ['PRODUCT_METRIC_CODES'],
  },
  '`kvkk_requests.scope`': { names: ['KVKK_REQUEST_SCOPES'] },
  '`kvkk_requests.rejection_reason`': { names: ['KVKK_REJECTION_REASONS'] },
  '`legal_hold` gerekçe kodları': { names: ['LEGAL_HOLD_REASONS'] },
  '`org_closures.phase` / `.mode` / `.blocked_reason`': {
    names: ['ORG_CLOSURE_PHASES', 'ORG_CLOSURE_MODES', 'ORG_CLOSURE_BLOCKED_REASONS'],
  },
  '`auth.account_recovery_requests.kind` / `.approval_path`': {
    names: ['RECOVERY_KINDS', 'RECOVERY_APPROVAL_PATHS'],
  },
  '`auth.account_recovery_requests.status`': { names: ['RECOVERY_STATUSES'] },
  '`NotificationClass`': { names: ['NOTIFICATION_CLASSES'] },
  '`email_deliveries.status`': { names: ['EMAIL_DELIVERY_STATUSES'] },
  '`NotificationKind` (yeni; P04a)': { names: ['NOTIFICATION_KINDS'] },
  'E-posta şablon kodu (`email_deliveries.template_code`) (yeni; P04a)': {
    names: ['EMAIL_TEMPLATE_CODES'],
  },
  '`email_deliveries.error_code` (yeni; P04a)': { names: ['EMAIL_ERROR_CODES'] },
  'AI görev kodu (`ai_task_routes.task`, `ai_usage.task`, `case_ai_logs.task`) (yeni)': {
    names: ['AI_TASKS'],
  },
  '`tool_calls.tool_name` (yeni)': { names: ['TOOL_CALL_NAMES'] },
  '`pending_file_jobs.queue` / `.job_name` (yeni)': {
    names: ['PENDING_FILE_QUEUES', 'PENDING_FILE_JOB_NAMES'],
  },
  '`subscription_changes.status` (yeni)': { names: ['SUBSCRIPTION_CHANGE_STATUSES'] },
  '`billing_events.outcome` (yeni)': { names: ['BILLING_EVENT_OUTCOMES'] },
  '`billing_profiles.tax_kind` (yeni)': { names: ['BILLING_TAX_KINDS'] },
  '`corpus.decisions.origin` (yeni)': { names: ['DECISION_ORIGINS'] },
  '`corpus.embed_staging.kind` (yeni)': { names: ['EMBED_STAGING_KINDS'] },
  'Retrieval `matchKind` / `surface` / `liveReasons`': {
    names: ['MATCH_KINDS', 'RETRIEVAL_SURFACES', 'LIVE_REASONS'],
  },
  '`support_tickets.status` / `.priority`': {
    names: ['SUPPORT_TICKET_STATUSES', 'SUPPORT_TICKET_PRIORITIES'],
  },
  '`DeadlineAcknowledgement`': { names: ['DEADLINE_ACKNOWLEDGEMENTS'] },
  '`DeadlineCalcDto.warnings[].code`': { names: ['DEADLINE_WARNING_CODES'] },
  '`DeadlineCalcDto.steps[].kind` (yeni)': { names: ['DEADLINE_STEP_KINDS'] },
  '`DeadlineRuleDto.periodNature`': { names: ['PERIOD_NATURES'] },
  '`AdminApplicationRejectInput.reasonCode`': { names: ['APPLICATION_REJECT_REASONS'] },
  '`ORG_SUSPEND_REASONS` / `USER_SUSPEND_REASONS`': {
    names: ['ORG_SUSPEND_REASONS', 'USER_SUSPEND_REASONS'],
  },
  '`RefundRecordInput.reasonCode`': { names: ['REFUND_REASONS'] },
  '`PayoutReportPreviewDto.reportStatus`': { names: ['PAYOUT_REPORT_STATUSES'] },
  'Admin başvuru `evidenceCode`': { names: ['RECOVERY_EVIDENCE_CODES'] },
  '`GET /files/:fileId/hidden-content` `items[].kind`': { names: ['HIDDEN_CONTENT_KINDS'] },
  '`ExportChecklistDto.items[].severity`': { names: ['EXPORT_CHECKLIST_SEVERITIES'] },
  '`SearchResultsDto.live.status` / `.overview.status`': {
    names: ['LIVE_SEARCH_STATUSES', 'SEARCH_OVERVIEW_STATUSES'],
  },
  '`providerOptions.eda.origin` (maskeleme köken türü, `Origin.kind`)': {
    names: ['MASKING_ORIGIN_KINDS'],
  },
  'Hata `reason` / `actions` / `meta` ve `fields[].issue` kümeleri': { names: [], mode: 'skip' },
};

const lines = readFileSync(SOURCE, 'utf8').split('\n');

function section(startPrefix: string, endPrefix: string): string[] {
  const start = lines.findIndex((l) => l.startsWith(startPrefix));
  if (start < 0) throw new Error(`bölüm bulunamadı: ${startPrefix}`);
  const rel = lines.slice(start + 1).findIndex((l) => l.startsWith(endPrefix));
  if (rel < 0) throw new Error(`bölüm sonu bulunamadı: ${endPrefix}`);
  return lines.slice(start, start + 1 + rel);
}

type Table = { sub: string; header: string[]; rows: string[][] };

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

function tables(block: readonly string[]): Table[] {
  const out: Table[] = [];
  let sub = '';
  let current: Table | undefined;
  for (const line of block) {
    if (line.startsWith('#')) sub = line;
    if (!line.trim().startsWith('|')) {
      current = undefined;
      continue;
    }
    const row = cells(line);
    if (row.every((c) => /^-*$/.test(c))) continue;
    if (current === undefined) {
      current = { sub, header: row, rows: [] };
      out.push(current);
    } else {
      current.rows.push(row);
    }
  }
  return out;
}

function backticks(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

function stripParens(text: string): string {
  let prev = '';
  let cur = text;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/\s*\([^()]*\)/g, '');
  }
  return cur.trim();
}

function cell(row: readonly string[], i: number): string {
  const c = row[i];
  if (c === undefined) throw new Error(`eksik hücre ${i}: ${row.join(' | ')}`);
  return c;
}

// ---------- §7 yapılandırma ----------

function queueNamesFrom17(): string[] {
  const t = tables(section('## 17.', '## 18.'))[0];
  if (t === undefined) throw new Error('§17 tablosu yok');
  return t.rows.map((r) => {
    const name = backticks(cell(r, 0))[0];
    if (name === undefined) throw new Error('§17 kuyruk adı yok');
    return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  });
}

function parseValue(raw: string): ConfigValue {
  const v = stripParens(raw);
  if (v.startsWith('[')) return JSON.parse(v) as (number | string)[];
  if (v.startsWith('"')) return JSON.parse(v) as string;
  const bt = /^`([^`]*)`$/.exec(v);
  if (bt !== null) {
    const inner = bt[1] ?? '';
    // virgüllü tek backtick değer (upload.allowedTypes) dizi olarak yorumlanır.
    return inner.includes(',') ? inner.split(',').map((s) => s.trim()) : inner;
  }
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  // "boş" (costGuard.balanceManual*) null olarak yorumlanır.
  if (v === 'boş') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  throw new Error(`ayrıştırılamayan değer: ${raw}`);
}

function buildConfig(): Record<string, ConfigEntry> {
  const out: Record<string, ConfigEntry> = {};
  const add = (key: string, value: ConfigValue, admin: string): void => {
    if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(key)) {
      throw new Error(`geçersiz anahtar: ${key}`);
    }
    if (key in out) throw new Error(`yinelenen anahtar: ${key}`);
    if (admin !== 'E' && admin !== 'H') throw new Error(`geçersiz Admin: ${key} ${admin}`);
    out[key] = { default: value, adminEditable: admin === 'E' };
  };
  const queues = queueNamesFrom17();
  const configTables = tables(section('## 7.', '### 7.2')).filter((t) => t.header[0] === 'Anahtar');
  if (configTables.length !== 2) throw new Error('§7 ve §7.1 tabloları bulunamadı');
  for (const t of configTables) {
    for (const row of t.rows) {
      const keys = backticks(cell(row, 0));
      const rawValue = cell(row, 1);
      const admin = cell(row, 2);
      const [first] = keys;
      if (first === undefined) throw new Error(`anahtarsız satır: ${row.join(' | ')}`);
      if (keys.length === 1 && first.endsWith('.<kuyruk>')) {
        const prefix = first.slice(0, -'<kuyruk>'.length);
        const parts = stripParens(rawValue).split(',');
        const seen: string[] = [];
        for (const part of parts) {
          const m = /^\s*([a-zA-Z]+)\s+(\d+)\s*$/.exec(part);
          if (m === null) throw new Error(`kuyruk değeri ayrıştırılamadı: ${part}`);
          const q = m[1] ?? '';
          seen.push(q);
          add(`${prefix}${q}`, Number(m[2]), admin);
        }
        if ([...seen].sort().join() !== [...queues].sort().join()) {
          throw new Error(`jobs.concurrency kuyrukları §17 ile uyuşmuyor: ${seen.join()}`);
        }
        continue;
      }
      if (keys.length === 1) {
        add(first, parseValue(rawValue), admin);
        continue;
      }
      const values = rawValue.split(' / ');
      if (values.length !== keys.length) throw new Error(`birleşik satır uyuşmuyor: ${first}`);
      keys.forEach((k, i) => {
        add(k, parseValue(values[i] ?? ''), admin);
      });
    }
  }
  return out;
}

// ---------- §11 enum ----------

function creditOpCodes(): string[] {
  const t = tables(section('### 12.4', '## 13.'))[0];
  if (t === undefined) throw new Error('§12.4 tablosu yok');
  return t.rows.flatMap((r) => backticks(cell(r, 0)));
}

function buildEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const set = (name: string, values: readonly string[]): void => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`geçersiz ad: ${name}`);
    if (name in out) throw new Error(`yinelenen enum: ${name}`);
    if (values.length === 0) throw new Error(`boş enum: ${name}`);
    if (new Set(values).size !== values.length) throw new Error(`yinelenen değer: ${name}`);
    out[name] = [...values];
  };
  const used = new Set<string>();
  const seenLabels = new Map<string, number>();
  for (const t of tables(section('## 11.', '## 12.'))) {
    if (t.sub.startsWith('### 11.7')) {
      const codes: string[] = [];
      const live: string[] = [];
      for (const r of t.rows) {
        const vals = backticks(stripParens(cell(r, 0)));
        codes.push(...vals);
        if (cell(r, 2).includes('**Açık**')) live.push(...vals);
      }
      set('SOURCE_CODES', codes);
      set('MVP_LIVE_SOURCE_CODES', live);
      continue;
    }
    if (t.sub.startsWith('### 11.8')) {
      set(
        'MASKING_TYPE_CODES',
        t.rows.flatMap((r) => backticks(cell(r, 0))),
      );
      continue;
    }
    if (t.header[0] !== 'Enum') throw new Error(`beklenmeyen tablo: ${t.sub}`);
    for (const r of t.rows) {
      const label = cell(r, 0);
      const n = (seenLabels.get(label) ?? 0) + 1;
      seenLabels.set(label, n);
      const key = n === 1 ? label : `${label}#${n}`;
      const spec = ENUM_ROWS[key];
      if (spec === undefined) throw new Error(`eşlemesiz enum satırı: ${key}`);
      used.add(key);
      const raw = cell(r, 1);
      const mode = spec.mode ?? 'split';
      if (mode === 'skip') continue;
      if (mode === 'creditOpCodes') {
        set(spec.names[0] ?? '', creditOpCodes());
        continue;
      }
      if (mode === 'capabilities') {
        const keys: string[] = [];
        const sub = new Map<string, string[]>();
        for (const m of raw.matchAll(/`(\w+)`(?:\s*\(([^()]*)\))?/g)) {
          const k = m[1] ?? '';
          keys.push(k);
          if (m[2] !== undefined) sub.set(k, backticks(m[2]));
        }
        const [a, b, c] = spec.names;
        set(a ?? '', keys);
        set(b ?? '', sub.get('thinking_param') ?? []);
        set(c ?? '', sub.get('prefix_cache') ?? []);
        continue;
      }
      if (mode === 'evalSuites') {
        const parts = raw.split('; paketler');
        if (parts.length !== 2) throw new Error('eval_runs.suite satırı ayrıştırılamadı');
        spec.names.forEach((name, i) => {
          set(name, backticks(parts[i] ?? ''));
        });
        continue;
      }
      const parts = raw.split(' / ');
      if (parts.length !== spec.names.length) throw new Error(`parça sayısı uyuşmuyor: ${key}`);
      spec.names.forEach((name, i) => {
        set(name, backticks(stripParens(parts[i] ?? '')));
      });
    }
  }
  const unused = Object.keys(ENUM_ROWS).filter((k) => !used.has(k));
  if (unused.length > 0) throw new Error(`kullanılmayan eşleme: ${unused.join(', ')}`);
  return out;
}

// ---------- §22 denetim olayları ----------

/** §22 tablosundaki olay kodları, tablo sırasıyla (parantez içi açıklamalar atılır). */
function buildAuditEvents(): string[] {
  const t = tables(section('## 22.', '## 23.')).find((x) => x.header[0] === 'Alan');
  if (t === undefined) throw new Error('§22 tablosu yok');
  const out: string[] = [];
  for (const row of t.rows) {
    for (const code of backticks(stripParens(cell(row, 1)))) {
      if (!/^[a-z_]+(\.[a-z_]+)+$/.test(code)) throw new Error(`geçersiz olay kodu: ${code}`);
      if (out.includes(code)) throw new Error(`yinelenen olay kodu: ${code}`);
      out.push(code);
    }
  }
  return out;
}

// ---------- §5 env ve §17 kuyruklar ----------

function buildEnv(): {
  edaEnvs: string[];
  noProxy: string;
  queues: string[];
  names: string[];
} {
  const envSection = section('## 5.', '## 6.');
  const edaRow = tables(section('### 5.1', '### 5.2'))
    .flatMap((t) => t.rows)
    .find((r) => backticks(cell(r, 0))[0] === 'EDA_ENV');
  if (edaRow === undefined) throw new Error('§5.1 EDA_ENV satırı yok');
  const noProxyLine = section('### 5.11', '### 5.12').find((l) => l.startsWith('NO_PROXY='));
  if (noProxyLine === undefined) throw new Error('§5.11 NO_PROXY satırı yok');
  const t17 = tables(section('## 17.', '## 18.'))[0];
  if (t17 === undefined) throw new Error('§17 tablosu yok');
  const queues = t17.rows.map((r) => {
    const name = backticks(cell(r, 0))[0];
    if (name === undefined) throw new Error('§17 kuyruk adı yok');
    return name;
  });
  // §5 içinde geçen büyük harfli adlar (env adlarının üst kümesi; KK-002-3 testi için).
  // §5.12 geçersiz adları dışarıda kalır (KK-002-9: geçersiz adlar kodda/fixture'da yaşamaz).
  const invalid = new Set(section('### 5.12', '### 5.13'));
  const names = new Set<string>();
  const text = envSection.filter((l) => !invalid.has(l)).join('\n');
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)) names.add(m[0]);
  return {
    edaEnvs: backticks(cell(edaRow, 1)),
    noProxy: noProxyLine.slice('NO_PROXY='.length).trim(),
    queues,
    names: [...names].sort(),
  };
}

// ---------- §20 hata kodları ----------

function buildErrors(): { prefixes: string[]; codes: Record<string, number | null> } {
  const t = tables(section('## 20.', '## 21.')).find((x) => x.header[0] === 'Önek');
  if (t === undefined) throw new Error('§20 önek tablosu yok');
  const prefixes: string[] = [];
  const codes: Record<string, number | null> = {};
  for (const row of t.rows) {
    const prefix = backticks(cell(row, 0))[0];
    if (prefix === undefined) throw new Error('§20 önek hücresi boş');
    prefixes.push(prefix);
    for (const m of cell(row, 1).matchAll(/`([A-Z][A-Z0-9_]+)`(?:\s*\((\d{3}))?/g)) {
      const code = m[1] ?? '';
      if (!code.startsWith(prefix)) throw new Error(`önek uyuşmuyor: ${code}`);
      if (code in codes) throw new Error(`yinelenen kod: ${code}`);
      codes[code] = m[2] === undefined ? null : Number(m[2]);
    }
  }
  return { prefixes, codes };
}

// ---------- çıktı ----------

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, stable(obj[k])]),
    );
  }
  return value;
}

// Biome JSON biçimlendiricisiyle aynı çıktı (genişlik 100): ilkel diziler sığarsa tek satır,
// nesneler her zaman açık. Böylece `biome check --write` fixture'ı değiştirmez.
const LINE_WIDTH = 100;

function format(value: unknown, indent: string, prefix: string, suffix: string): string[] {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${prefix}[]${suffix}`];
    const flat = `${indent}${prefix}[${value.map((v) => JSON.stringify(v)).join(', ')}]${suffix}`;
    const primitive = value.every((v) => v === null || typeof v !== 'object');
    if (primitive && flat.length <= LINE_WIDTH) return [flat];
    return [
      `${indent}${prefix}[`,
      ...value.flatMap((v, i) => format(v, inner, '', i < value.length - 1 ? ',' : '')),
      `${indent}]${suffix}`,
    ];
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${indent}${prefix}{}${suffix}`];
    return [
      `${indent}${prefix}{`,
      ...entries.flatMap(([k, v], i) =>
        format(v, inner, `${JSON.stringify(k)}: `, i < entries.length - 1 ? ',' : ''),
      ),
      `${indent}}${suffix}`,
    ];
  }
  return [`${indent}${prefix}${JSON.stringify(value)}${suffix}`];
}

function render(value: unknown): string {
  return `${format(stable(value), '', '', '').join('\n')}\n`;
}

const outputs: [string, string][] = [
  [join(FIXTURES, 'canon-config.json'), render(buildConfig())],
  [join(FIXTURES, 'canon-enums.json'), render(buildEnums())],
  [join(FIXTURES, 'canon-env.json'), render(buildEnv())],
  [join(FIXTURES, 'canon-errors.json'), render(buildErrors())],
  [join(FIXTURES, 'canon-audit-events.json'), render(buildAuditEvents())],
];

const check = process.argv.includes('--check');
let drift = false;
for (const [file, content] of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const name = relative(REPO_ROOT, file);
  if (current === content) continue;
  if (check) {
    drift = true;
    const script = relative(REPO_ROOT, import.meta.filename);
    process.stderr.write(`FARK: ${name} 002 ile uyuşmuyor; 'node ${script}' çalıştırın\n`);
  } else {
    writeFileSync(file, content);
    process.stdout.write(`yazıldı: ${name}\n`);
  }
}
if (drift) process.exitCode = 1;
