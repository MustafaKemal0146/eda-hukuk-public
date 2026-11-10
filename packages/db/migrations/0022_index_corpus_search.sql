-- eda:kind index
-- eda:no-transaction
-- L8 (032 §2.1, §8.3; 030 §1.5, §13; 023 §3–§4): korpus arama indeksleri, boş tabloda. HNSW yalnız
-- corpus'ta (halfvec_cosine_ops, m = 16, ef_construction = 64); BM25 (pg_textsearch 1.5.1, kurulu
-- sürümde söz dizimi doğrulandı: USING bm25 (kolon) WITH (text_config = ...), kısmi WHERE ve
-- CONCURRENTLY destekli) yalnız corpus'ta. app şemasında HNSW/BM25 YASAK (RLS istatistik sızıntısı).
-- Yarım kalan deneme geçersiz indeks bırakır (E3): önce DROP INDEX CONCURRENTLY IF EXISTS.
DROP INDEX CONCURRENTLY IF EXISTS corpus.decision_chunks_hnsw_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS decision_chunks_hnsw_idx ON corpus.decision_chunks
  USING hnsw (emb halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS corpus.law_article_chunks_hnsw_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS law_article_chunks_hnsw_idx ON corpus.law_article_chunks
  USING hnsw (emb halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS corpus.decision_sections_bm25_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS decision_sections_bm25_idx ON corpus.decision_sections
  USING bm25 (text_norm) WITH (text_config = 'public.tr_hukuk') WHERE role <> 'kunye';
--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS corpus.law_articles_bm25_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS law_articles_bm25_idx ON corpus.law_articles
  USING bm25 (text_norm) WITH (text_config = 'public.tr_hukuk');
