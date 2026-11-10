-- eda:kind rls
-- P17b (054 §8.2, 030 §8): sürümler değişmezdir; yalnız `name` (ad verme) güncellenebilir. Tablo
-- düzeyi UPDATE verilmez, kolon düzeyi `UPDATE (name)` verilir; politika, belgeye yazma erişimi olanla
-- sınırlıdır (insert politikasıyla aynı ifade). `org_id`/`document_id` değişimini tetikleyici zaten engeller.
CREATE POLICY document_versions_update ON app.document_versions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_versions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))))
  WITH CHECK (EXISTS (SELECT 1 FROM app.documents d WHERE d.id = document_versions.document_id AND ((d.case_id IS NULL AND d.owner_id = (SELECT app.current_user_id())) OR (d.case_id IS NOT NULL AND app.has_case_access(d.case_id)))));
GRANT UPDATE (name) ON app.document_versions TO eda_app;
