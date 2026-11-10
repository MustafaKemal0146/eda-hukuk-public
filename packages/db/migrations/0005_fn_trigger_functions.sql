-- eda:kind fn
-- L3 (032 §2.1; 030 §1.8): ortak tetikleyici fonksiyonları, auth ve bayi tablolarındaki bağları.
-- `app.log_deletion()` deletion_log tablosundan sonra (fn_deletion_log) gelir. Tetikleyici
-- fonksiyonları SECURITY INVOKER'dır; tek istisna `guard_partner_member_exclusive` (eda_sec_definer).

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.set_updated_at() FROM PUBLIC;

-- Ekli tablolar (031 §6.6): deyim düzeyi BEFORE UPDATE OR DELETE; sahip (eda_owner) dahil.
CREATE OR REPLACE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'ekli tablo yalnız eklemeye açıktır: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501',
          HINT = 'Saklama sonu imhası yalnız bölüm kaldırmayla yapılır (app.drop_expired_partitions).';
END
$$;
REVOKE ALL ON FUNCTION app.forbid_mutation() FROM PUBLIC;

-- Değişmez anahtar kolonları (031 §6.1 madde 5): argümanlar kolon adlarıdır. Tetikleyici yalnız
-- WHEN koşulu (eski <> yeni) doğruyken çağrılır. Sahiplik devri yalnız eda_sec_definer sahipli
-- fonksiyonlardan geçer (app.transfer_member_content).
CREATE OR REPLACE FUNCTION app.forbid_key_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  k text;
  o jsonb := pg_catalog.to_jsonb(OLD);
  n jsonb := pg_catalog.to_jsonb(NEW);
BEGIN
  IF current_user = 'eda_sec_definer' THEN
    RETURN NEW;
  END IF;
  FOREACH k IN ARRAY TG_ARGV LOOP
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      RAISE EXCEPTION 'anahtar kolon değiştirilemez: %.%', TG_TABLE_NAME, k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.forbid_key_change() FROM PUBLIC;

-- Sohbet veri sınıfı yalnız yükselir: public < client < case (defter §28.4, 002 §11.2).
CREATE OR REPLACE FUNCTION app.guard_conversation_data_class() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  levels constant text[] := ARRAY['public', 'client', 'case'];
BEGIN
  IF NEW.data_class = 'public' AND NEW.public_mode_declared_at IS NULL THEN
    RAISE EXCEPTION 'genel araştırma sınıfı beyan olmadan seçilemez'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND pg_catalog.array_position(levels, NEW.data_class)
         < pg_catalog.array_position(levels, OLD.data_class) THEN
    RAISE EXCEPTION 'sohbet veri sınıfı düşürülemez: % -> %', OLD.data_class, NEW.data_class
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.guard_conversation_data_class() FROM PUBLIC;

-- Bayi kullanıcısı büro üyesi olamaz ve tersi (defter §30.4; 030 §1.8). SECURITY DEFINER: auth.members
-- ve app.partner_members'ta yalnız user_id okur.
CREATE OR REPLACE FUNCTION app.guard_partner_member_exclusive() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_TABLE_SCHEMA = 'auth' THEN
    IF EXISTS (SELECT 1 FROM app.partner_members p WHERE p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'bayi kullanıcısı büro üyesi yapılamaz' USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM auth.members m WHERE m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'büro üyesi bayi kullanıcısı yapılamaz' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.guard_partner_member_exclusive() FROM PUBLIC;
GRANT SELECT (user_id) ON auth.members TO eda_sec_definer;
GRANT SELECT (user_id) ON app.partner_members TO eda_sec_definer;

CREATE TRIGGER members_guard_partner_exclusive
  BEFORE INSERT OR UPDATE OF user_id ON auth.members
  FOR EACH ROW EXECUTE FUNCTION app.guard_partner_member_exclusive();
CREATE TRIGGER partner_members_guard_partner_exclusive
  BEFORE INSERT OR UPDATE OF user_id ON app.partner_members
  FOR EACH ROW EXECUTE FUNCTION app.guard_partner_member_exclusive();
-- Sahiplik devri tetikleyiciler bağlandıktan sonra (CREATE TRIGGER, fonksiyonda EXECUTE ister).
ALTER FUNCTION app.guard_partner_member_exclusive() OWNER TO eda_sec_definer;

-- updated_at bağları: auth tabloları ve RLS'siz bayi tabloları (030 §14). RLS'li app tabloları
-- kendi rls dosyalarında bağlanır.
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON auth.sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON auth.accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER verifications_set_updated_at BEFORE UPDATE ON auth.verifications
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON auth.organizations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON auth.members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER partners_set_updated_at BEFORE UPDATE ON app.partners
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER partner_members_set_updated_at BEFORE UPDATE ON app.partner_members
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
