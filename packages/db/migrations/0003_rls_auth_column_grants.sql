-- eda:kind rls
-- auth şeması kolon yetkileri (031 §3; yetki metni 031'dir, 030 §3.2 sonundaki liste değil: AS-0076).
-- auth şemasında RLS YOK: kiracı sınırı rol ve kolon yetkisiyle sağlanır. eda_auth DML yetkisini
-- 0000'daki DEFAULT PRIVILEGES verir. eda_app accounts, two_factors, verifications, sessions,
-- passkeys ve account_recovery_requests üzerinde HİÇ yetki almaz. eda_worker, eda_app yetkilerini
-- miras alır (INHERIT TRUE). eda_jobs kolon yetkileri P03b'dedir (031 §11).
GRANT SELECT (id, name, email, email_verified, image, platform_role, verification_status, created_at)
  ON auth.users TO eda_app;
GRANT SELECT (id, name, slug, logo, kind, partner_code, created_at)
  ON auth.organizations TO eda_app;
GRANT SELECT (id, organization_id, user_id, role, status, created_at)
  ON auth.members TO eda_app;
-- Davet kimliği (id) kabul bağlantısındaki taşıyıcı token'dır: eda_app'e VERİLMEZ.
GRANT SELECT (organization_id, role, status, expires_at)
  ON auth.invitations TO eda_app;

-- RLS yardımcılarının sahibi (P03b) için dar kolon okumaları (özyineleme önlemi; 031 §3, §5.3).
GRANT SELECT (organization_id, user_id, role, status) ON auth.members TO eda_rls_helper;
GRANT SELECT (id, verification_status, banned) ON auth.users TO eda_rls_helper;
