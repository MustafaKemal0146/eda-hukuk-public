-- eda:kind rls
-- KK-031-15 / KK-P03c-6 (docs/perf/p03-rls-case-list.md): dava politikalarında satır başına
-- `app.is_org_member(cases.org_id)` çağrısı (SECURITY DEFINER, satır içine alınamaz) 10.000 davalık
-- listede her satır için üyelik birleştirmesi yapıyordu. Aynı anlam InitPlan biçimiyle yazıldı:
-- `org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL` (031 §5.4,
-- Tuzak 8). Politika adları ve kapsamı değişmez (manifest aynı); DROP + CREATE aynı işlemde (031 §7).
-- Diğer tablolardaki `is_org_member(<satır>)` kullanımları AS-0178'de izlenir.

DROP POLICY cases_select ON app.cases;
CREATE POLICY cases_select ON app.cases FOR SELECT
  USING (cases.org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL
         AND (cases.visibility = 'org' OR cases.created_by = (SELECT app.current_user_id())
              OR app.has_case_access(cases.id)));

DROP POLICY cases_insert ON app.cases;
CREATE POLICY cases_insert ON app.cases FOR INSERT
  WITH CHECK (cases.org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL
              AND cases.created_by = (SELECT app.current_user_id()));

DROP POLICY cases_update ON app.cases;
CREATE POLICY cases_update ON app.cases FOR UPDATE
  USING (cases.org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL
         AND (cases.visibility = 'org' OR cases.created_by = (SELECT app.current_user_id())
              OR app.has_case_access(cases.id)))
  WITH CHECK (cases.org_id = (SELECT app.current_org_id()) AND (SELECT app.member_role()) IS NOT NULL);
