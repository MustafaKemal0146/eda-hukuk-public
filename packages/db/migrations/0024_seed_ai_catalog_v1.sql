-- eda:kind seed
-- L9 (032 §10.2; 002 §12; 020 §3.3): AI kataloğu v1 — ai_providers (4), ai_models (3), ai_task_routes
-- (10). Model kimlikleri YALNIZ *_seed_ai_*.sql ve seed/dev içinde bulunur (Y-96, M-15). v1
-- `ON CONFLICT DO NOTHING`: `enabled` ve `priority` yönetici alanıdır; sonraki değişiklik yeni seed
-- dosyasıyla açık UPDATE olarak yapılır. `mock` sağlayıcısı prod veritabanına girmez (seed/dev/dev-base).
-- `anthropic` ve `anthropic-eu` satırları P07d'nin seed dosyasındadır (AS-0174). Değerler başlangıç
-- varsayımıdır; sözleşme/DPA bulgularıyla (020, 061) yeni seed dosyasında güncellenir.

INSERT INTO app.ai_providers
  (id, kind, display_name, region, transfer_basis, allowed_data_classes, secret_ref, base_url,
   training_use, human_review, retention_days, enabled, priority)
VALUES
 ('deepseek',  'deepseek',          'DeepSeek',                           'CN', 'none',        '{public}',             'deepseek_api_key',   'https://api.deepseek.com', true,  true,  NULL, true,  10),
 ('azure-eu',  'azure',             'Azure AI Foundry (AB veri bölgesi)', 'EU', 'scc_pending', '{public}',             'azure_eu_api_key',   NULL,                       false, true,  30,   false, 20),
 ('local',     'openai_compatible', 'Yerel model (TR)',                   'TR', 'domestic',    '{public,client,case}', 'local_llm_api_key',  NULL,                       false, false, 0,    false, 30),
 ('vertex-eu', 'vertex',            'Google Vertex AI (AB)',              'EU', 'scc_pending', '{public}',             'vertex_credentials', NULL,                       true,  true,  NULL, false, 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.ai_models
 (alias, provider_id, model_id, label,
  cache_hit_offpeak_micro_usd_per_mtok, cache_hit_peak_micro_usd_per_mtok,
  input_offpeak_micro_usd_per_mtok, input_peak_micro_usd_per_mtok,
  output_offpeak_micro_usd_per_mtok, output_peak_micro_usd_per_mtok,
  peak_schedule, context_budget, max_output_tokens, thinking, capabilities, priority, enabled)
VALUES
 ('edai-flash', 'deepseek', 'deepseek-flash', 'DeepSeek V4.1 Flash',
  3000, 6000, 150000, 300000, 600000, 1200000,
  '{"tz":"Europe/Istanbul","days":[1,2,3,4,5],"ranges":[["04:00","07:00"],["09:00","13:00"]]}',
  64000, 16000, 'off',
  '{"tools":true,"parallel_tools":true,"strict_tools":true,"thinking_param":"deepseek","reasoning_echo_required":true,"tool_choice_in_thinking":false,"json_schema_output":false,"prefix_cache":"deepseek_unit","max_output_tokens":393216,"vision":false}', 10, true),
 ('edai-pro', 'deepseek', 'deepseek-v4-pro', 'DeepSeek V4 Pro',
  22000, 44000, 660000, 1320000, 1980000, 3960000,
  '{"tz":"Europe/Istanbul","days":[1,2,3,4,5],"ranges":[["04:00","07:00"],["09:00","13:00"]]}',
  64000, 16000, 'high',
  '{"tools":true,"parallel_tools":true,"strict_tools":true,"thinking_param":"deepseek","reasoning_echo_required":true,"tool_choice_in_thinking":false,"json_schema_output":false,"prefix_cache":"deepseek_unit","max_output_tokens":393216,"vision":false}', 10, true),
 ('edai-flash', 'azure-eu', 'DeepSeek-V4-Flash', 'DeepSeek V4 Flash (Azure AB)',
  31000, 31000, 210000, 210000, 560000, 560000,
  NULL, 64000, 16000, 'off',
  '{"tools":false,"parallel_tools":false,"strict_tools":false,"thinking_param":"none","reasoning_echo_required":false,"tool_choice_in_thinking":false,"json_schema_output":false,"prefix_cache":"auto","max_output_tokens":32768,"vision":false}', 20, true)
ON CONFLICT (alias, provider_id, model_id) DO NOTHING;

-- Görev rotaları (002 §12.3; 032 §10.2 tablosu). summarize_history.default_alias CHECK gereği
-- edai-flash (032 Açık Sorular 5). Sınıf kuralı ve sıcaklık task-policy.ts sabitindedir (020 §5.1).
INSERT INTO app.ai_task_routes
  (task, alias_source, default_alias, thinking_override, tool_set, credit_op_code, max_output_tokens, enabled)
VALUES
 ('chat',                   'user_choice',       'edai-flash', NULL,  'chat_tools',     NULL,             8000,  true),
 ('draft_document',         'user_choice',       'edai-flash', 'off', 'submit_outline', 'document_draft', 16000, true),
 ('edit_document',          'fixed',             'edai-flash', 'off', 'edit_document',  'edit_round',     4000,  true),
 ('title',                  'fixed',             'edai-flash', 'off', 'none',           NULL,             32,    true),
 ('summarize_history',      'conversation_last', 'edai-flash', NULL,  'chat_tools',     NULL,             4000,  true),
 ('search_overview',        'fixed',             'edai-flash', 'off', 'none',           NULL,             600,   true),
 ('decision_summary',       'fixed',             'edai-flash', 'off', 'submit_result',  NULL,             1200,  true),
 ('file_card',              'fixed',             'edai-flash', 'off', 'submit_result',  'file_card',      1500,  true),
 ('pii_risk_check',         'local_engine',      NULL,         NULL,  'none',           NULL,             NULL,  true),
 ('citation_support_check', 'fixed',             'edai-flash', 'off', 'submit_result',  NULL,             800,   false)
ON CONFLICT (task) DO NOTHING;
