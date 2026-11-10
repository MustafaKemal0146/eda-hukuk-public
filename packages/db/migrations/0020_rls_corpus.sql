-- eda:kind rls
-- corpus şeması (030 §13; 031 §6.5, §11): RLS YOK (kiracısız kamu korpusu). eda_app SELECT ve
-- eda_worker DML yetkileri 0000'daki DEFAULT PRIVILEGES ile gelmiştir. Bu dosya updated_at
-- tetikleyicilerini (030 §14) bağlar ve usage.rollup için eda_jobs'a source_status okumasını verir.

CREATE TRIGGER decisions_set_updated_at BEFORE UPDATE ON corpus.decisions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER laws_set_updated_at BEFORE UPDATE ON corpus.laws
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER law_articles_set_updated_at BEFORE UPDATE ON corpus.law_articles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER source_status_set_updated_at BEFORE UPDATE ON corpus.source_status
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

GRANT USAGE ON SCHEMA corpus TO eda_jobs;
GRANT SELECT (source, live_enabled, breaker_state, state, p95_ms, bucket_fill_pct, last_success_at,
  last_error_at, last_error_code, updated_at) ON corpus.source_status TO eda_jobs;
