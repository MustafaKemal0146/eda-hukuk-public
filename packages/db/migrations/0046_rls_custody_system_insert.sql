-- eda:kind rls
-- P20 (033 §8.1, §2.3; 031 §11): sistem delil zinciri kaydı. Delil zinciri ekli (append-only) tablodur ve
-- mevcut INSERT politikası aktörün oturumdaki kullanıcı olmasını ister (`actor_id = current_user_id`).
-- Worker işlemlerinin ürettiği olaylar (saklama süresi, karantina imhası) kullanıcıya atfedilmez:
-- `actor_type = 'system'`, `actor_id IS NULL`. Politika YALNIZ `eda_worker` rolüne ve YALNIZ `delete`
-- olayına açılır; kiracı kapısı (RESTRICTIVE `tenant_guard`) ve nesne/evrak varlığı koşulu geçerlidir.
-- UPDATE/DELETE zaten yetkilendirilmemiştir (0007). Tablo yetkisi `eda_app` mirasıyla gelir.
CREATE POLICY custody_events_insert_system ON app.custody_events FOR INSERT TO eda_worker
  WITH CHECK (actor_type = 'system' AND actor_id IS NULL AND event = 'delete');
