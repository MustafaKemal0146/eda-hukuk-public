-- eda:kind rls
-- P04b (045 §6.5 adım 2; AS-0361): davet e-postasının alıcısı. Satırın `user_id` değeri davet edendir;
-- worker davet adresini yalnız davet edenin bağlamında (`inviter_id = app.current_user_id()`) okur.
-- `id`, `email` (0018, 0027) ve eda_app'ten miras kalan `organization_id`, `role`, `status`,
-- `expires_at` yetkilerine `inviter_id` eklenir.
GRANT SELECT (inviter_id) ON auth.invitations TO eda_worker;
