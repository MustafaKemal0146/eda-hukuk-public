-- eda:kind ext
-- L1 (032 §2.1, §6.2 madde 3, 5, 6): initdb nesnelerinin varlık denetimi. Roller, eklentiler ve FTS
-- sözlükleri süper kullanıcı ister; migrasyon bunları OLUŞTURMAZ, yoksa durur. Çalıştırıcının ön koşul
-- denetimiyle (src/migrate/preflight.ts) aynıdır: çıplak psql ile uygulanırsa da durur (023 §3.1).
DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(e ORDER BY e) INTO missing
  FROM unnest(ARRAY['vector', 'pg_textsearch', 'pg_trgm', 'unaccent', 'pgcrypto',
                    'pg_stat_statements', 'btree_gist']) AS e
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension x WHERE x.extname = e);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ön koşul eksik: eklenti %', array_to_string(missing, ', ')
      USING HINT = 'initdb 030-extensions.sql veya infra/postgres/upgrade/ yolu (073)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config c
                 JOIN pg_catalog.pg_namespace n ON n.oid = c.cfgnamespace
                 WHERE n.nspname = 'public' AND c.cfgname = 'tr_hukuk') THEN
    RAISE EXCEPTION 'ön koşul eksik: public.tr_hukuk FTS yapılandırması'
      USING HINT = 'initdb 040-text-search.sql';
  END IF;
  SELECT array_agg(d ORDER BY d) INTO missing
  FROM unnest(ARRAY['tr_hukuk_protected', 'tr_hukuk_stem']) AS d
  WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_dict t
                    JOIN pg_catalog.pg_namespace n ON n.oid = t.dictnamespace
                    WHERE n.nspname = 'public' AND t.dictname = d);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ön koşul eksik: FTS sözlüğü %', array_to_string(missing, ', ')
      USING HINT = 'initdb 040-text-search.sql';
  END IF;
  -- ts_debug duman testi (023 §3.6): korunan terimler kök bulucuya gitmeden sabit leksem olur.
  IF to_tsvector('public.tr_hukuk'::regconfig, 'kanunun maddesi') <> 'kanun:1 madde:2'::tsvector THEN
    RAISE EXCEPTION 'ön koşul eksik: tr_hukuk duman testi (kanunun maddesi -> kanun, madde)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_collation WHERE collname = 'tr-TR-x-icu') THEN
    RAISE EXCEPTION 'ön koşul eksik: tr-TR-x-icu harmanlaması (ICU)';
  END IF;
  IF to_regprocedure('uuidv7()') IS NULL THEN
    RAISE EXCEPTION 'ön koşul eksik: uuidv7() (PostgreSQL 18)';
  END IF;
END
$$;
