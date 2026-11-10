-- 040-text-search.sql — Türkçe hukuk FTS yapılandırması public.tr_hukuk (023 §3.1-§3.3).
-- (023'te dosya adı 020-text-search.sql geçer; 070 §10.2 sırası geçerlidir.)
-- Sözlük dosyaları imajdadır: $SHAREDIR/tsearch_data/tr_hukuk_protected.syn ve tr_hukuk.stop.
-- Sahiplik eda_owner'a devredilir; sonraki güncellemeler migrasyonla yapılır (023 §3.5).
\set ON_ERROR_STOP on

-- Korunan hukuk terimleri: kök bulucuya gönderilmeden sabit lekseme çevrilir (kanunun -> kanun)
CREATE TEXT SEARCH DICTIONARY public.tr_hukuk_protected (
  TEMPLATE = pg_catalog.synonym,
  SYNONYMS = tr_hukuk_protected
);
-- Snowball Türkçe kök bulucu + genişletilmiş durak sözcükler (turkish.stop + göre, ilişkin, dair, istinaden, itibaren)
CREATE TEXT SEARCH DICTIONARY public.tr_hukuk_stem (
  TEMPLATE  = pg_catalog.snowball,
  Language  = turkish,
  StopWords = tr_hukuk
);
CREATE TEXT SEARCH CONFIGURATION public.tr_hukuk (COPY = pg_catalog.turkish);
ALTER TEXT SEARCH CONFIGURATION public.tr_hukuk
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH public.tr_hukuk_protected, public.tr_hukuk_stem;
-- int, uint, numword, numhword, hword_numpart, file, float, sfloat, version:
-- turkish'ten kopyalanan 'simple' eşlemesinde kalır ('4369/82', '2021/1234' tek lekse).

ALTER TEXT SEARCH DICTIONARY    public.tr_hukuk_protected OWNER TO eda_owner;
ALTER TEXT SEARCH DICTIONARY    public.tr_hukuk_stem      OWNER TO eda_owner;
ALTER TEXT SEARCH CONFIGURATION public.tr_hukuk           OWNER TO eda_owner;
