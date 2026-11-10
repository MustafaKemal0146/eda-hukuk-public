-- eda:kind fn
-- L7 (032 §2.1, §6.4; 030 §1.6; 031 §6.6): dört ekli tablonun aylık bölüm fonksiyonları. Bölüm adı
-- <tablo>_p<yyyy>_<mm>; her çağrıda içinde bulunulan ay + 3 ay garanti edilir; DEFAULT bölüm YOK.
-- Her bölüm ENABLE + FORCE ROW LEVEL SECURITY (politikasız = her şeyi reddet) ve çalışma zamanı
-- rollerinden REVOKE ALL alır: bölüme doğrudan erişim yok (RLS-26). Sınırlar UTC ay başıdır.
-- Fonksiyonların sahibi eda_owner (DDL sahiplik ister); EXECUTE yalnız eda_jobs (partitions.maintain).
-- İlk bölümler 0016_partition_initial ile kurulur; migrate her koşuda app.ensure_partitions()
-- çağırır (KK-032-19).

CREATE OR REPLACE FUNCTION app.ensure_partitions() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t text;
  m integer;
  v_from timestamptz;
  v_to timestamptz;
  part text;
  created integer := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'ai_usage', 'custody_events', 'credit_ledger'] LOOP
    FOR m IN 0..3 LOOP
      v_from := (pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')
                 + pg_catalog.make_interval(months => m)) AT TIME ZONE 'UTC';
      v_to := ((v_from AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
      part := pg_catalog.format('%s_p%s', t, pg_catalog.to_char(v_from AT TIME ZONE 'UTC', 'YYYY_MM'));
      IF pg_catalog.to_regclass(pg_catalog.format('app.%I', part)) IS NULL THEN
        EXECUTE pg_catalog.format(
          'CREATE TABLE app.%I PARTITION OF app.%I FOR VALUES FROM (%L) TO (%L)',
          part, t, v_from, v_to);
        created := created + 1;
      END IF;
      EXECUTE pg_catalog.format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', part);
      EXECUTE pg_catalog.format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', part);
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE app.%I FROM eda_app, eda_worker, eda_jobs, eda_readonly_admin', part);
    END LOOP;
  END LOOP;
  RETURN created;
END
$$;
REVOKE ALL ON FUNCTION app.ensure_partitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_partitions() TO eda_jobs;

-- Saklama sonu imhası (035): verilen tablonun p_keep_months aydan eski bölümleri kaldırılır. Silme
-- zamanlaması 035/043 işidir; burada imza ve koruma: tablo kümesi kapalıdır, en az 1 ay korunur ve
-- mühürlenmemiş satır taşıyan audit_log bölümü SİLİNMEZ (audit_seals zinciri bölümü kapsamalı).
CREATE OR REPLACE FUNCTION app.drop_expired_partitions(p_table text, p_keep_months integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_cutoff timestamptz;
  v_unsealed boolean;
  dropped integer := 0;
BEGIN
  IF p_table IS NULL OR p_table <> ALL (ARRAY['audit_log', 'ai_usage', 'custody_events', 'credit_ledger']) THEN
    RAISE EXCEPTION 'bölümlü ekli tablo değil: %', p_table USING ERRCODE = '22023';
  END IF;
  IF p_keep_months IS NULL OR p_keep_months < 1 THEN
    RAISE EXCEPTION 'saklama süresi en az 1 ay olmalı' USING ERRCODE = '22023';
  END IF;
  v_cutoff := (pg_catalog.date_trunc('month', pg_catalog.now() AT TIME ZONE 'UTC')
               - pg_catalog.make_interval(months => p_keep_months)) AT TIME ZONE 'UTC';
  FOR r IN
    SELECT c.relname,
           (regexp_match(pg_catalog.pg_get_expr(c.relpartbound, c.oid), 'TO \(''([^'']+)''\)'))[1]::timestamptz AS upper_bound
    FROM pg_catalog.pg_inherits i
    JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = pg_catalog.format('app.%I', p_table)::regclass
  LOOP
    CONTINUE WHEN r.upper_bound IS NULL OR r.upper_bound > v_cutoff;
    IF p_table = 'audit_log' THEN
      EXECUTE pg_catalog.format(
        'SELECT EXISTS (SELECT 1 FROM app.%I a WHERE NOT EXISTS (SELECT 1 FROM app.audit_seals s'
        ' WHERE s.chain_key = coalesce(a.org_id::text, ''platform'') AND s.period_end >= a.created_at))',
        r.relname) INTO v_unsealed;
      CONTINUE WHEN v_unsealed;
    END IF;
    EXECUTE pg_catalog.format('DROP TABLE app.%I', r.relname);
    dropped := dropped + 1;
  END LOOP;
  RETURN dropped;
END
$$;
REVOKE ALL ON FUNCTION app.drop_expired_partitions(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.drop_expired_partitions(text, integer) TO eda_jobs;

