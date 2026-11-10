-- CI denetim sorguları (031 §13; TK-02). migrate'in son adımıdır: her sorgu 0 satır döndürmelidir,
-- aksi hâlde migrate çıkış 50 (032 §6.5). psql söz dizimi: çalıştırıcı `-- Qn:` ayraçlarıyla böler ve
-- :'ad' değişkenlerini konumsal parametreye çevirir. Parametreler: k_tables (K ve "—" app tabloları),
-- content_columns (içerik kolon yasak listesi); ikisi de RLS manifestinden üretilir (src/rls/manifest.ts).

-- Q1: FORCE RLS eksik kiracılı tablo (partition'lar dahil)
SELECT c.oid::regclass AS tablo
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
  AND c.relname <> ALL (:'k_tables'::text[])
  AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

-- Q2: RLS açık ama politikasız ana tablo (partition hariç)
SELECT c.oid::regclass
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);

-- Q3: Kiracı kapısı (RESTRICTIVE) eksik E tablosu
SELECT c.oid::regclass
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND c.relname <> ALL (:'k_tables'::text[])
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive);

-- Q4: K tablolarında çalışma zamanı rollerine yazma yetkisi
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'app' AND table_name = ANY (:'k_tables'::text[])
  AND grantee IN ('eda_app', 'eda_worker', 'eda_auth')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- Q5: PUBLIC'e verilmiş tablo yetkisi veya PUBLIC'in çalıştırabildiği SECURITY DEFINER
SELECT table_schema, table_name FROM information_schema.role_table_grants
WHERE grantee = 'PUBLIC' AND table_schema IN ('auth', 'app', 'corpus')
UNION ALL
SELECT n.nspname, p.oid::regprocedure::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('app', 'auth', 'corpus') AND p.prosecdef
  AND has_function_privilege('public', p.oid, 'EXECUTE');

-- Q6: search_path sabitlenmemiş SECURITY DEFINER
SELECT p.oid::regprocedure
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('app', 'auth', 'corpus') AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                  WHERE cfg LIKE 'search_path=%');

-- Q7: Beklenmeyen süper kullanıcı / BYPASSRLS
SELECT rolname FROM pg_roles
WHERE (rolsuper AND rolname <> 'postgres')
   OR (rolbypassrls AND rolname NOT IN ('postgres', 'eda_jobs', 'eda_rls_helper', 'eda_sec_definer'))
   OR (rolcanlogin AND rolname IN ('eda_rls_helper', 'eda_sec_definer'));

-- Q8: eda_owner dışında sahibi olan tablo/görünüm/dizi/indeks
SELECT c.oid::regclass, pg_get_userbyid(c.relowner)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('auth', 'app', 'corpus') AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i', 'I')
  AND pg_get_userbyid(c.relowner) <> 'eda_owner';

-- Q9: Politikada doğrudan current_setting veya GEÇERSİZ rol oturum değişkeni
SELECT schemaname, tablename, policyname FROM pg_policies
WHERE coalesce(qual, '') ~ '(current_setting|app\.role)'
   OR coalesce(with_check, '') ~ '(current_setting|app\.role)';

-- Q10: eda_jobs'un içerik kolonuna erişimi (istisnalar yalnız UPDATE, okuma yok: messages.reasoning
-- (031 §11, §13) ve email_deliveries.sealed_params (045 §6.2 madde 3: süresi geçen mühür açılmadan
-- NULL'lanır; P04a, AS-0285))
SELECT table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE grantee = 'eda_jobs' AND table_schema = 'app'
  AND column_name = ANY (:'content_columns'::text[])
  AND NOT (privilege_type = 'UPDATE'
           AND ((table_name = 'messages' AND column_name = 'reasoning')
                OR (table_name = 'email_deliveries' AND column_name = 'sealed_params')));

-- Q11: Partition'lara doğrudan yetki
SELECT c.oid::regclass, g.grantee
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN information_schema.role_table_grants g ON g.table_schema = n.nspname AND g.table_name = c.relname
WHERE n.nspname = 'app' AND c.relispartition
  AND g.grantee IN ('eda_app', 'eda_worker', 'eda_jobs', 'eda_readonly_admin');

-- Q12: eda_readonly_admin'in rollup dışı tablo yetkisi
SELECT table_schema, table_name FROM information_schema.role_table_grants
WHERE grantee = 'eda_readonly_admin'
  AND NOT (table_schema = 'app' AND (table_name LIKE 'admin\_rollup\_%' OR table_name = 'partner_rollup_monthly'));
