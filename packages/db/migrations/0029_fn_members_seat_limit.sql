-- eda:kind fn
-- P04b (042 §4.3, KK-042-9, KK-042-16; 002 §9 "Büro, koltuk ve davet fonksiyonları"): koltuk
-- tetikleyicisi ve personel üyelik koruması. Asıl koltuk denetimi budur; Better Auth `membershipLimit`
-- ve davet ön denetimi yalnız erken, anlaşılır hata içindir. RLS ile yapılmaz (özyineleme): kilit canlı
-- abonelik satırında (`FOR UPDATE`), abonelik yoksa büro başı danışma kilidindedir; aynı büroya
-- eşzamanlı eklemeler sıralanır ve READ COMMITTED altında sayım kilit alındıktan sonraki deyimde
-- yapılır (yeni anlık görüntü). Kullanım askıdaki üyeleri de sayar; silinen üye koltuk tutmaz.
-- Sahibi eda_sec_definer (BYPASSRLS), search_path sabit, PUBLIC'e EXECUTE yok.

GRANT SELECT (id, org_id, plan_code, status, seats, created_at) ON app.subscriptions TO eda_sec_definer;
-- `SELECT … FOR UPDATE` en az bir kolonda UPDATE yetkisi ister; fonksiyon satırı güncellemez.
GRANT UPDATE (updated_at) ON app.subscriptions TO eda_sec_definer;
GRANT SELECT (code, seat_max) ON app.plans TO eda_sec_definer;
GRANT SELECT (organization_id) ON auth.members TO eda_sec_definer;

CREATE OR REPLACE FUNCTION app.enforce_seat_limit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_cap integer;
  v_sub uuid;
  v_used integer;
BEGIN
  SELECT s.id, LEAST(s.seats, COALESCE(p.seat_max, s.seats)) INTO v_sub, v_cap
  FROM app.subscriptions s JOIN app.plans p ON p.code = s.plan_code
  WHERE s.org_id = NEW.organization_id AND s.status IN ('trialing', 'active', 'past_due')
  ORDER BY s.created_at DESC
  LIMIT 1
  FOR UPDATE OF s;
  IF v_sub IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('seats:' || NEW.organization_id::text, 0));
    v_cap := 1;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_used
  FROM auth.members m WHERE m.organization_id = NEW.organization_id;
  IF v_used >= v_cap THEN
    RAISE EXCEPTION 'seat_limit_reached' USING ERRCODE = 'EDA01';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.enforce_seat_limit() FROM PUBLIC;

-- Platform personeli (`support`, `super_admin`) hiçbir büroya üye olamaz (042 §2.6, KK-042-16).
CREATE OR REPLACE FUNCTION app.guard_member_platform_role() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id AND u.platform_role <> 'user') THEN
    RAISE EXCEPTION 'platform personeli büro üyesi yapılamaz' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app.guard_member_platform_role() FROM PUBLIC;

CREATE TRIGGER members_seat_limit
  BEFORE INSERT ON auth.members
  FOR EACH ROW EXECUTE FUNCTION app.enforce_seat_limit();
CREATE TRIGGER members_guard_platform_role
  BEFORE INSERT OR UPDATE OF user_id ON auth.members
  FOR EACH ROW EXECUTE FUNCTION app.guard_member_platform_role();

-- Sahiplik devri tetikleyiciler bağlandıktan sonra (CREATE TRIGGER, fonksiyonda EXECUTE ister).
ALTER FUNCTION app.enforce_seat_limit() OWNER TO eda_sec_definer;
ALTER FUNCTION app.guard_member_platform_role() OWNER TO eda_sec_definer;
