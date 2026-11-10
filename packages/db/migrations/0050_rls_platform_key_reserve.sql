-- eda:kind rls
-- Platform ortak anahtarı kotasının ATOMİK REZERVASYONU (AS-0409; güvenlik düzeltmesi; hassas yol: maliyet).
-- Sorun: kota kapısı sayımı tur ÖNCESİ yapıyor, kullanım tur BİTİNCE yazılıyordu; eşzamanlı turlar günlük
-- kullanıcı/büro sınırını aşabiliyordu ve süren tur sayacı tek süreç belleğindeydi.
-- Çözüm (hepsi veritabanında; çok süreçte ve yeniden başlatmada da geçerli):
-- (1) platform_key_usage.reservation (yeni, NULL olabilen kolon): `open` = tur başlamadan yazılan rezervasyon
--     (satır status='stopped' yer tutucusuyla sayılır), `released` = kullanılmayan rezervasyonun iadesi (hiçbir
--     sayaca girmez), NULL = kapanmış normal kayıt. Mevcut CHECK'ler değişmez.
-- (2) app.platform_key_reserve(...): büro ve kullanıcı için işlem düzeyi advisory kilit altında sayar,
--     sınırları (kullanıcı, büro ve PLATFORM GENELİ günlük maliyet tavanı) denetler ve rezervasyon satırını (tahmini maliyetle) tek işlemde ekler. Sınırlar API
--     tarafından yapılandırma zinciri + geçersiz kılmalarla çözülüp parametre olarak verilir (NULL = sınırsız);
--     eşzamanlı akış sınırı da burada uygulanır (etkin pencere içindeki açık rezervasyon satırları). Ret nedeni
--     döner (user_day|user_month|org_day|platform_day|concurrent); satır eklenmez.
-- (3) app.platform_key_settle(...): tur bitince rezervasyonu gerçek durum/token/maliyetle kapatır veya
--     `released` ile iade eder (yalnız çağıranın kendi açık rezervasyon satırı).
-- (4) platform_key_usage_today ve admin_ai_platform_card `released` satırları saymaz.
-- Yetki: iki yeni fonksiyonun EXECUTE'u yalnız eda_app'e; sahibi eda_sec_definer (tabloya yazma yetkisi
-- yalnız sütun düzeyinde ona verilir). Geri alma: yeni fonksiyonlar ve sec_definer yetkileri düşürülür,
-- kolon düşürülür (önce açık rezervasyonlar kapatılmalı); today/card 0047 gövdesine döner.

ALTER TABLE "app"."platform_key_usage" ADD COLUMN "reservation" text;
--> statement-breakpoint

GRANT SELECT (id, status, reservation) ON app.platform_key_usage TO eda_sec_definer;
GRANT INSERT (org_id, user_id, conversation_id, model_alias, cost_micro_usd, status, reservation, request_id) ON app.platform_key_usage TO eda_sec_definer;
GRANT UPDATE (input_tokens, output_tokens, cost_micro_usd, status, reservation) ON app.platform_key_usage TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.platform_key_reserve(
  p_turns_day integer, p_tokens_day bigint, p_turns_month integer, p_tokens_month bigint,
  p_org_cap bigint, p_platform_cap bigint, p_reserve_cost bigint, p_max_concurrent integer, p_active_window_sec integer,
  p_model_alias text, p_conversation_id uuid, p_request_id text
)
RETURNS TABLE (reservation_id uuid, denied text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
  v_org uuid := app.current_org_id();
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                             AT TIME ZONE 'Europe/Istanbul';
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                               AT TIME ZONE 'Europe/Istanbul';
  v_count bigint;
  v_sum bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM auth.members m JOIN auth.users x ON x.id = m.user_id
       WHERE m.organization_id = v_org AND m.user_id = v_uid AND m.status = 'active'
         AND x.verification_status = 'verified' AND NOT x.banned) THEN
    RAISE EXCEPTION 'ortak anahtar yalnız doğrulanmış büro üyesi içindir' USING ERRCODE = '42501';
  END IF;
  IF p_reserve_cost IS NULL OR p_reserve_cost < 0 OR p_model_alias NOT IN ('edai-flash', 'edai-pro') THEN
    RAISE EXCEPTION 'geçersiz rezervasyon parametresi' USING ERRCODE = '22023';
  END IF;
  -- Kilit sırası sabit (önce platform, sonra büro, sonra kullanıcı): kilitlenme olmaz. Kilit işlem sonunda kalkar; sonraki
  -- rezervasyon bu işlemin satırını görür (READ COMMITTED: her sorgu yeni anlık görüntü).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eda:pk:platform', 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eda:pk:org:' || v_org::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('eda:pk:user:' || v_uid::text, 0));

  IF p_platform_cap IS NOT NULL THEN
    SELECT coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint INTO v_sum FROM app.platform_key_usage u
     WHERE u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start;
    IF v_sum >= p_platform_cap THEN
      RETURN QUERY SELECT NULL::uuid, 'platform_day'::text;
      RETURN;
    END IF;
  END IF;

  SELECT pg_catalog.count(*), coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
    INTO v_count, v_sum FROM app.platform_key_usage u
   WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start;
  IF (p_turns_day IS NOT NULL AND v_count >= p_turns_day)
     OR (p_tokens_day IS NOT NULL AND v_sum >= p_tokens_day) THEN
    RETURN QUERY SELECT NULL::uuid, 'user_day'::text;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*), coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
    INTO v_count, v_sum FROM app.platform_key_usage u
   WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_month_start;
  IF (p_turns_month IS NOT NULL AND v_count >= p_turns_month)
     OR (p_tokens_month IS NOT NULL AND v_sum >= p_tokens_month) THEN
    RETURN QUERY SELECT NULL::uuid, 'user_month'::text;
    RETURN;
  END IF;

  IF p_org_cap IS NOT NULL THEN
    SELECT coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint INTO v_sum FROM app.platform_key_usage u
     WHERE u.org_id = v_org AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start;
    IF v_sum >= p_org_cap THEN
      RETURN QUERY SELECT NULL::uuid, 'org_day'::text;
      RETURN;
    END IF;
  END IF;

  IF p_max_concurrent IS NOT NULL THEN
    SELECT pg_catalog.count(*) INTO v_count FROM app.platform_key_usage u
     WHERE u.user_id = v_uid AND u.reservation = 'open'
       AND u.created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_active_window_sec);
    IF v_count >= p_max_concurrent THEN
      RETURN QUERY SELECT NULL::uuid, 'concurrent'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO app.platform_key_usage (org_id, user_id, conversation_id, model_alias, cost_micro_usd, status, reservation, request_id)
  VALUES (v_org, v_uid, p_conversation_id, p_model_alias, p_reserve_cost, 'stopped', 'open', p_request_id)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, NULL::text;
END
$$;

CREATE OR REPLACE FUNCTION app.platform_key_settle(
  p_id uuid, p_status text, p_input_tokens integer, p_output_tokens integer, p_cost bigint
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_status NOT IN ('success', 'error', 'timeout', 'stopped', 'released')
     OR p_input_tokens < 0 OR p_output_tokens < 0 OR p_cost < 0 THEN
    RAISE EXCEPTION 'geçersiz kapanış parametresi' USING ERRCODE = '22023';
  END IF;
  UPDATE app.platform_key_usage u
     SET status = CASE WHEN p_status = 'released' THEN 'error' ELSE p_status END,
         reservation = CASE WHEN p_status = 'released' THEN 'released' ELSE NULL END,
         input_tokens = CASE WHEN p_status = 'released' THEN 0 ELSE p_input_tokens END,
         output_tokens = CASE WHEN p_status = 'released' THEN 0 ELSE p_output_tokens END,
         cost_micro_usd = CASE WHEN p_status = 'released' THEN 0 ELSE p_cost END
   WHERE u.id = p_id AND u.user_id = app.current_user_id() AND u.org_id = app.current_org_id()
     AND u.reservation = 'open';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END
$$;

REVOKE ALL ON FUNCTION app.platform_key_reserve(integer, bigint, integer, bigint, bigint, bigint, bigint, integer, integer, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_key_settle(uuid, text, integer, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.platform_key_reserve(integer, bigint, integer, bigint, bigint, bigint, bigint, integer, integer, text, uuid, text) TO eda_app;
GRANT EXECUTE ON FUNCTION app.platform_key_settle(uuid, text, integer, integer, bigint) TO eda_app;
ALTER FUNCTION app.platform_key_reserve(integer, bigint, integer, bigint, bigint, bigint, bigint, integer, integer, text, uuid, text) OWNER TO eda_sec_definer;
ALTER FUNCTION app.platform_key_settle(uuid, text, integer, integer, bigint) OWNER TO eda_sec_definer;

-- Mevcut iki fonksiyonun gövdesi yenilenir (`released` satırlar sayılmaz). ACL ve sahiplik CREATE OR REPLACE
-- ile korunur; sahip eda_sec_definer olduğundan değişiklik o rolle yapılır (0048 örneği).
SET LOCAL ROLE eda_sec_definer;

CREATE OR REPLACE FUNCTION app.platform_key_usage_today()
RETURNS TABLE (
  user_turns_day bigint, user_tokens_day bigint, user_turns_month bigint, user_tokens_month bigint,
  org_cost_day bigint, org_seats integer,
  ov_turns_day integer, ov_turns_month integer, ov_tokens_day bigint, ov_tokens_month bigint,
  org_cap_floor bigint, org_cap_per_seat bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := app.current_user_id();
  v_org uuid := app.current_org_id();
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                             AT TIME ZONE 'Europe/Istanbul';
  v_month_start timestamptz := pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'Europe/Istanbul')
                               AT TIME ZONE 'Europe/Istanbul';
BEGIN
  -- Ortak anahtar yalnız meslek doğrulaması tamam ve askıda olmayan etkin büro üyesi içindir.
  IF v_uid IS NULL OR v_org IS NULL OR NOT EXISTS (
       SELECT 1 FROM auth.members m JOIN auth.users x ON x.id = m.user_id
       WHERE m.organization_id = v_org AND m.user_id = v_uid AND m.status = 'active'
         AND x.verification_status = 'verified' AND NOT x.banned) THEN
    RAISE EXCEPTION 'ortak anahtar yalnız doğrulanmış büro üyesi içindir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT pg_catalog.count(*) FROM app.platform_key_usage u
      WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start),
    (SELECT coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
       FROM app.platform_key_usage u WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start),
    (SELECT pg_catalog.count(*) FROM app.platform_key_usage u
      WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_month_start),
    (SELECT coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint
       FROM app.platform_key_usage u WHERE u.user_id = v_uid AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_month_start),
    (SELECT coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint
       FROM app.platform_key_usage u WHERE u.org_id = v_org AND u.reservation IS DISTINCT FROM 'released' AND u.created_at >= v_day_start),
    (SELECT pg_catalog.count(*)::integer FROM auth.members m
      WHERE m.organization_id = v_org AND m.status = 'active'),
    o.chat_turns_per_day, o.chat_turns_per_month, o.tokens_per_day, o.tokens_per_month,
    (SELECT l.value FROM app.org_limit_overrides l
      WHERE l.org_id = v_org AND l.key = 'costGuard.orgDailyCapFloorMicroUsd'),
    (SELECT l.value FROM app.org_limit_overrides l
      WHERE l.org_id = v_org AND l.key = 'costGuard.orgDailyCapPerSeatMicroUsd')
  FROM (SELECT 1) AS one
  LEFT JOIN app.user_limit_overrides o ON o.user_id = v_uid;
END
$$;

CREATE OR REPLACE FUNCTION app.admin_ai_platform_card(p_actor_id uuid)
RETURNS TABLE (turns bigint, users bigint, orgs bigint, tokens bigint, cost_micro_usd bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici platform anahtarı kartını okuyabilir' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pg_catalog.count(*)::bigint,
         pg_catalog.count(DISTINCT u.user_id)::bigint,
         pg_catalog.count(DISTINCT u.org_id)::bigint,
         coalesce(pg_catalog.sum(u.input_tokens::bigint + u.output_tokens), 0)::bigint,
         coalesce(pg_catalog.sum(u.cost_micro_usd), 0)::bigint
  FROM app.platform_key_usage u
  WHERE u.reservation IS DISTINCT FROM 'released' AND u.created_at >= pg_catalog.now() - interval '24 hours';
END
$$;

REVOKE ALL ON FUNCTION app.platform_key_usage_today() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.admin_ai_platform_card(uuid) FROM PUBLIC;

RESET ROLE;
