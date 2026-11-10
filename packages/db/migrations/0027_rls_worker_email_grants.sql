-- eda:kind rls
-- P04a (045 §6.2, §13.2; 031 §11; 042 Açık Soru 6): e-posta outbox yetki ekleri.
-- eda_jobs (email_outbox.sweep): süresi geçen satırın mühürlü parametresi açılmadan silinir
-- (`sealed_params = NULL`, `status = 'expired'`); okuma yetkisi verilmez.
-- eda_worker (email.send): davet alıcısı `auth.invitations(id, email)` ile çözülür (P04b kullanır);
-- `email` 0018'de verilmişti, filtre kolonu `id` eksikti. eda_app'e email_deliveries yazma yetkisi
-- verilmez (yazma yalnız app.email_enqueue, 0026).
GRANT UPDATE (sealed_params) ON app.email_deliveries TO eda_jobs;
GRANT SELECT (id) ON auth.invitations TO eda_worker;
-- email_outbox.sweep yeniden kuyruğa alırken iş seçeneklerini (öncelik, kimlik şablonu saklama) şablon
-- koduna göre kurar; şablon kodu içerik değildir.
GRANT SELECT (template_code) ON app.email_deliveries TO eda_jobs;
