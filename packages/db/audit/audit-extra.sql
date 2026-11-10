-- Ek denetim sorguları (032 §6.5): audit.sql ile birlikte migrate'in son adımı; her sorgu 0 satır.
-- E1/E2 bölümlü ekli tablolarla (P03b), E6'nın ai_providers/ai_models/deadline_rules kolları
-- tablolarını kuran migrasyonlarla aynı PR'da eklenmiştir (AS-0078).
-- Parametreler: eda_env (EDA_ENV), definer_write_grants (RLS manifestindeki kalıcı definer yazma
-- yetkileri, "şema.tablo.kolon.YETKİ" biçiminde; src/rls/manifest.ts definerWriteGrants()).

-- E1: ekli tabloların içinde bulunulan ay + 3 ay bölümü eksik (bölüm sınırları UTC ay başıdır)
WITH want AS (
  SELECT t.relname AS parent,
         to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + (g || ' month')::interval, 'YYYY_MM') AS ym
  FROM unnest(ARRAY['audit_log', 'ai_usage', 'custody_events', 'credit_ledger']) AS t(relname),
       generate_series(0, 3) AS g)
SELECT w.parent, w.ym FROM want w
WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'app' AND c.relname = w.parent || '_p' || w.ym);

-- E2: DEFAULT bölüm var (yasak)
SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relispartition AND pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT';

-- E3: geçersiz (yarım kalmış CONCURRENTLY) indeks
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

-- E4: defter tablolarında çalışma zamanı rolü yetkisi
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('schema_migrations', 'seed_runs') AND grantee <> 'eda_owner';

-- E5: tanımlı olmayan geçici GRANT kalıntısı (backfill)
SELECT grantee, table_schema || '.' || table_name || '.' || column_name || '.' || privilege_type AS g
FROM information_schema.column_privileges
WHERE grantee IN ('eda_sec_definer', 'eda_rls_helper') AND table_schema IN ('auth', 'app', 'corpus')
  AND privilege_type <> 'SELECT'
  AND (table_schema || '.' || table_name || '.' || column_name || '.' || privilege_type) <> ALL (:'definer_write_grants'::text[]);

-- E6: seed tutarlılığı
SELECT 'mock_provider_outside_dev' AS ihlal
  WHERE :'eda_env'::text NOT IN ('development', 'test')
    AND EXISTS (SELECT 1 FROM app.ai_providers WHERE kind = 'mock')
UNION ALL SELECT 'dev_fixture_rule_outside_dev'
  WHERE :'eda_env'::text NOT IN ('development', 'test')
    AND EXISTS (SELECT 1 FROM app.deadline_rules WHERE code LIKE 'dev\_fixture\_%')
UNION ALL SELECT 'sample_org_outside_dev'
  WHERE :'eda_env'::text NOT IN ('development', 'test')
    AND EXISTS (SELECT 1 FROM auth.organizations WHERE metadata LIKE '%"sampleData":true%')
UNION ALL SELECT 'client_case_class_without_terms'
  WHERE EXISTS (SELECT 1 FROM app.ai_providers p
                WHERE ('client' = ANY (p.allowed_data_classes) OR 'case' = ANY (p.allowed_data_classes))
                  AND NOT (p.kind = 'mock' OR (p.transfer_basis IN ('domestic', 'scc_notified')
                           AND NOT p.training_use AND NOT p.human_review AND p.retention_days <= 30)))
UNION ALL SELECT 'enabled_model_without_price'
  WHERE EXISTS (SELECT 1 FROM app.ai_models m JOIN app.ai_providers p ON p.id = m.provider_id
                WHERE m.enabled AND p.kind NOT IN ('mock', 'openai_compatible')
                  AND (m.input_offpeak_micro_usd_per_mtok = 0 OR m.output_offpeak_micro_usd_per_mtok = 0))
UNION ALL SELECT 'deadline_rule_selectable_without_verifier'
  WHERE EXISTS (SELECT 1 FROM app.deadline_rules WHERE verified_at IS NOT NULL AND verified_by IS NULL);
