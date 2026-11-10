-- eda:kind partition
-- L7 (032 §2.1; 030 §1.6): içinde bulunulan ay + 3 ay bölümleri (audit_log, ai_usage, custody_events,
-- credit_ledger). Bölüm CREATE TABLE ... PARTITION OF elle yazılmaz (032 §5 madde 5): yalnız
-- app.ensure_partitions() kurar; her bölüm FORCE RLS + REVOKE alır.
SELECT app.ensure_partitions();
