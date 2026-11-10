-- 001-eda-owner-read-settings.sql — mevcut kümeye initdb 010-roles.sql eki (P03a; AS-0079).
-- migrate'in ön koşul denetimi shared_preload_libraries ayarını okur (032 §6.2 madde 4); bu ayar
-- yalnız pg_read_all_settings üyelerine görünür. Yinelenebilir: ikinci çalıştırma uyarı verir, hata vermez.
-- Uygulama: README.md (dc.sh dev exec -T postgres psql -U postgres -d eda < bu dosya).
\set ON_ERROR_STOP on
GRANT pg_read_all_settings TO eda_owner;
