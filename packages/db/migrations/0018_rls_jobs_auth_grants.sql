-- eda:kind rls
-- auth şemasında eda_jobs ve eda_worker kolon yetkileri (031 §11; 045 §13; 042 Açık Soru 6).
-- auth RLS'sizdir: sınır rol ve kolon yetkisidir. eda_jobs BYPASSRLS'tir ve yalnız sayılan
-- kolonları görür; içerik/sır kolonu (accounts, two_factors, passkeys, sessions.token,
-- verifications.value) yetkisi YOK. app tablolarındaki eda_jobs yetkileri rls_app_* dosyalarında
-- manifestten (jobsColumns) üretilmiştir.

-- orphans.sweep (043 §10.4): süresi dolmuş oturum/doğrulama, doğrulanmamış hesap, davet, kurtarma talebi.
GRANT SELECT (id, user_id, expires_at, active_organization_id) ON auth.sessions TO eda_jobs;
GRANT UPDATE (active_organization_id) ON auth.sessions TO eda_jobs;
GRANT DELETE ON auth.sessions TO eda_jobs;
GRANT SELECT (id, expires_at) ON auth.verifications TO eda_jobs;
GRANT DELETE ON auth.verifications TO eda_jobs;
GRANT SELECT (organization_id, status, expires_at, created_at) ON auth.invitations TO eda_jobs;
GRANT UPDATE (status) ON auth.invitations TO eda_jobs;
GRANT DELETE ON auth.invitations TO eda_jobs;
GRANT SELECT (id, user_id, kind, status, requested_at, expires_at, completed_at)
  ON auth.account_recovery_requests TO eda_jobs;
GRANT UPDATE (status) ON auth.account_recovery_requests TO eda_jobs;
GRANT DELETE ON auth.account_recovery_requests TO eda_jobs;

-- account.erase, orphans.sweep (035): kullanıcı silme (app tarafı FK eylemleriyle; sahip kolonları
-- NO ACTION olduğundan önce devir gerekir).
GRANT SELECT (id, email_verified, verification_status, banned, created_at, updated_at)
  ON auth.users TO eda_jobs;
GRANT DELETE ON auth.users TO eda_jobs;

-- org_closure.advance, org.purge (035 §8), usage.rollup: üyelik ve büro kimlik/durum kolonları.
GRANT SELECT (id, organization_id, user_id, role, status, created_at) ON auth.members TO eda_jobs;
GRANT DELETE ON auth.members TO eda_jobs;
GRANT SELECT (id, kind, partner_code, suspended_at, closed_at, created_at)
  ON auth.organizations TO eda_jobs;
GRANT UPDATE (name, logo, metadata, closed_at) ON auth.organizations TO eda_jobs;

-- eda_worker ekleri (eda_app mirasına ek): e-posta gönderimi ve kurtarma bildirimi.
GRANT SELECT (email, name, email_verified, banned) ON auth.users TO eda_worker;
GRANT SELECT (email) ON auth.invitations TO eda_worker;
GRANT SELECT (id, new_email) ON auth.account_recovery_requests TO eda_worker;
