// Dev aşamaları (032 §11.1; yalnız development/test, `dev` profili):
//   dev-base          : `mock` sağlayıcı (priority 1, enabled) + `mock-flash` / `mock-pro` modelleri
//                       (020 §3.3 yetenekleri, fiyat 0); `ON CONFLICT DO NOTHING`
//   dev-fixture-rules : `dev_fixture_14_day` süre kuralı (yasal dayanak DEĞİLDİR; E6 prod'da reddeder)
//   dev-sample : örnek büro dünyası; kimlik kısmı `dev-sample-identity.ts` (P04b)
// Bu dosya prod profilinde yüklenmez (index.ts aşama kapısı).
import type { SeedDef } from '../types.ts';
import { type UpsertSpec, upsertRows } from '../upsert.ts';

const MOCK_PROVIDER = {
  id: 'mock',
  kind: 'mock',
  display_name: 'Simülasyon',
  region: 'NONE',
  transfer_basis: null,
  allowed_data_classes: ['public', 'client', 'case'],
  secret_ref: null,
  base_url: null,
  training_use: false,
  human_review: false,
  retention_days: 0,
  enabled: true,
  priority: 1,
} as const;

const MOCK_CAPABILITIES = {
  tools: true,
  parallel_tools: true,
  strict_tools: true,
  thinking_param: 'none',
  reasoning_echo_required: false,
  tool_choice_in_thinking: true,
  json_schema_output: true,
  prefix_cache: 'none',
  max_output_tokens: 65536,
  vision: false,
} as const;

const mockModel = (alias: 'edai-flash' | 'edai-pro', modelId: string) => ({
  alias,
  provider_id: 'mock',
  model_id: modelId,
  label: 'Simülasyon',
  context_budget: 64000,
  max_output_tokens: 16000,
  thinking: 'off',
  capabilities: JSON.stringify(MOCK_CAPABILITIES),
  priority: 1,
  enabled: true,
});

const MOCK_MODELS = [mockModel('edai-flash', 'mock-flash'), mockModel('edai-pro', 'mock-pro')];

const PROVIDER_SPEC: UpsertSpec = {
  table: 'app.ai_providers',
  key: ['id'],
  columns: Object.keys(MOCK_PROVIDER),
  update: [],
  casts: { allowed_data_classes: 'text[]' },
};

const MODEL_SPEC: UpsertSpec = {
  table: 'app.ai_models',
  key: ['alias', 'provider_id', 'model_id'],
  columns: Object.keys(MOCK_MODELS[0] ?? {}),
  update: [],
  casts: { capabilities: 'jsonb' },
};

export function devBaseSeed(): SeedDef {
  const provider = {
    ...MOCK_PROVIDER,
    allowed_data_classes: [...MOCK_PROVIDER.allowed_data_classes],
  };
  return {
    name: 'dev-base',
    stage: 'dev-base',
    content: { provider, models: MOCK_MODELS },
    async apply(q) {
      const a = await upsertRows(q, PROVIDER_SPEC, [provider]);
      const b = await upsertRows(q, MODEL_SPEC, MOCK_MODELS);
      return {
        inserted: a.inserted + b.inserted,
        updated: a.updated + b.updated,
        skipped: a.skipped + b.skipped,
      };
    },
  };
}

/** 032 §10.5 "Dev/test kuralı": `verified_by = 'DEV-FIXTURE'`, yasal dayanak değildir. */
export const DEV_FIXTURE_RULE = {
  code: 'dev_fixture_14_day',
  version: 1,
  branch: 'hmk',
  title: 'Örnek veri süre kuralı (14 gün)',
  law_ref: 'Örnek veri (yasal dayanak değildir)',
  law_no: null,
  article_no: null,
  duration_value: 14,
  duration_unit: 'day',
  start_events: ['service'],
  recess_applies: false,
  params: '{}',
  effective_during: '[2024-01-01,)',
  notes: 'Örnek veri; yalnız development/test',
  verified_by: 'DEV-FIXTURE',
  verified_at: '2026-10-11T00:00:00+03:00',
} as const;

const RULE_SPEC: UpsertSpec = {
  table: 'app.deadline_rules',
  key: ['code', 'version'],
  columns: Object.keys(DEV_FIXTURE_RULE),
  update: [],
  casts: {
    start_events: 'text[]',
    params: 'jsonb',
    effective_during: 'daterange',
    verified_at: 'timestamptz',
  },
};

export function devFixtureRulesSeed(): SeedDef {
  const row = { ...DEV_FIXTURE_RULE, start_events: [...DEV_FIXTURE_RULE.start_events] };
  return {
    name: 'dev-fixture-rules',
    stage: 'dev-fixture-rules',
    content: row,
    apply: (q) => upsertRows(q, RULE_SPEC, [row]),
  };
}
