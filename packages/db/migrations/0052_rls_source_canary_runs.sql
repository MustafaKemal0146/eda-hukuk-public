-- eda:kind rls
-- Kaynak kanaryası (021 §7.3; 002 §10.3): corpus.source_canary_runs yoklama sonuç tablosu ve yönetim
-- paneli "Sistem > Kaynak durumu" okuma fonksiyonu.
-- (1) Tablo corpus şemasındadır (kiracısız kamu korpusu kalıbı, RLS YOK): eda_worker DML ve eda_app SELECT
--     0000'daki DEFAULT PRIVILEGES ile gelir. Satırda sorgu metni, yanıt içeriği, belge kimliği YOKTUR;
--     yalnız yoklama kodu, sonuç, süre (ms) ve zaman. Saklama `sources.canaryWindowDays` (canary işi siler).
-- (2) app.admin_system_source_canary(aktör, pencere günü): yoklama başına son sonuç, pencere içindeki
--     çalıştırma/başarı sayısı ve son başarıdan bu yana art arda başarısızlık. Sahibi eda_sec_definer,
--     EXECUTE yalnız eda_readonly_admin; aktör super_admin (yasaklı/askıda değil) olarak doğrulanır.
--     Yoklama listesi SQL'e gömülmez: veri olan yoklamalar döner, eksikler API'de sözleşme listesinden
--     "henüz kontrol yok" olarak tamamlanır.
-- Geri alma: fonksiyon ve tablo düşürülür (veri kaybı: yalnız son 7 günün yoklama sonuçları).

CREATE TABLE "corpus"."source_canary_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"probe" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_canary_runs_probe_chk" CHECK ("probe" IN ('uyap_search', 'anayasa_search', 'uyusmazlik_search', 'mevzuat_search', 'mevzuat_article')),
	CONSTRAINT "source_canary_runs_outcome_chk" CHECK ("outcome" IN ('ok', 'empty', 'error', 'timeout')),
	CONSTRAINT "source_canary_runs_duration_ms_chk" CHECK ("duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "source_canary_runs_probe_idx" ON "corpus"."source_canary_runs" USING btree ("probe","checked_at" DESC NULLS LAST);
--> statement-breakpoint

GRANT SELECT (probe, outcome, duration_ms, checked_at) ON corpus.source_canary_runs TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.admin_system_source_canary(p_actor_id uuid, p_window_days integer)
RETURNS TABLE (
  probe text, last_checked_at timestamptz, last_outcome text, last_duration_ms integer,
  window_runs integer, window_ok integer, consecutive_failures integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_actor_id AND a.platform_role = 'super_admin' AND NOT a.banned
                   AND a.verification_status <> 'suspended') THEN
    RAISE EXCEPTION 'yalnız süper yönetici sistem durumunu okuyabilir' USING ERRCODE = '42501';
  END IF;
  IF p_window_days IS NULL OR p_window_days NOT BETWEEN 1 AND 90 THEN
    RAISE EXCEPTION 'pencere günü geçersiz' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH probes AS (
    SELECT DISTINCT r.probe FROM corpus.source_canary_runs r
  ),
  last_ok AS (
    SELECT r.probe, pg_catalog.max(r.checked_at) AS at
    FROM corpus.source_canary_runs r WHERE r.outcome = 'ok' GROUP BY r.probe
  )
  SELECT p.probe, l.checked_at, l.outcome, l.duration_ms,
         coalesce(w.runs, 0), coalesce(w.oks, 0), coalesce(f.fails, 0)
  FROM probes p
  LEFT JOIN LATERAL (
    SELECT r.checked_at, r.outcome, r.duration_ms FROM corpus.source_canary_runs r
    WHERE r.probe = p.probe ORDER BY r.checked_at DESC LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.count(*)::integer AS runs,
           (pg_catalog.count(*) FILTER (WHERE r.outcome = 'ok'))::integer AS oks
    FROM corpus.source_canary_runs r
    WHERE r.probe = p.probe
      AND r.checked_at >= pg_catalog.now() - pg_catalog.make_interval(days => p_window_days)
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.count(*)::integer AS fails FROM corpus.source_canary_runs r
    LEFT JOIN last_ok o ON o.probe = r.probe
    WHERE r.probe = p.probe AND r.outcome <> 'ok'
      AND (o.at IS NULL OR r.checked_at > o.at)
  ) f ON true
  ORDER BY p.probe;
END
$$;

REVOKE ALL ON FUNCTION app.admin_system_source_canary(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admin_system_source_canary(uuid, integer) TO eda_readonly_admin;

-- Sahiplik devri en sonda (yetkiler sahip eda_owner iken verilir; devirle ACL korunur).
ALTER FUNCTION app.admin_system_source_canary(uuid, integer) OWNER TO eda_sec_definer;
