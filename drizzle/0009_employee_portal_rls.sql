-- ───────────────────────────────────────────────────────────────────────────
-- 0009_employee_portal_rls — Phase 4.6 of the agent-backend brief
-- + SPEC-AMENDMENT-001 §8.3.
--
-- Employee-scope read/write policies. Pattern:
--
--   USING (
--     <table>.<owner_column> = (
--       SELECT id FROM employees WHERE user_id = auth.uid()
--     )
--   )
--
-- Authenticated users with role='employee' can read/write only their own
-- rows. Other roles continue to use the existing service-role-all
-- policies via the server-action layer (which respects RBAC).
--
-- The `current_employee_id()` helper centralizes the subquery and lets
-- a future tuning pass replace it with a SETOF function or cached GUC.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_employee_id() RETURNS uuid AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1
$$ LANGUAGE sql STABLE SECURITY INVOKER;
--> statement-breakpoint

-- ── leaves: read/write self ──────────────────────────────────────────────
CREATE POLICY "employee self read" ON "leaves"
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self insert" ON "leaves"
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() AND status = 'applied');
--> statement-breakpoint
CREATE POLICY "employee self update cancel" ON "leaves"
  FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() AND status IN ('applied','approved'))
  WITH CHECK (employee_id = public.current_employee_id());
--> statement-breakpoint

-- ── reimbursements: read/write self (only while submitted) ───────────────
CREATE POLICY "employee self read" ON "reimbursements"
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self insert" ON "reimbursements"
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.current_employee_id() AND status = 'submitted');
--> statement-breakpoint
CREATE POLICY "employee self update submitted" ON "reimbursements"
  FOR UPDATE TO authenticated
  USING (employee_id = public.current_employee_id() AND status = 'submitted')
  WITH CHECK (employee_id = public.current_employee_id());
--> statement-breakpoint

-- ── salary_lines: read self only (no write — payroll is HR/admin work) ───
CREATE POLICY "employee self read" ON "salary_lines"
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());
--> statement-breakpoint

-- ── salary_structures: read self only ────────────────────────────────────
CREATE POLICY "employee self read" ON "salary_structures"
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());
--> statement-breakpoint

-- ── salary_runs headers visible to managers for own reports ──────────────
-- (Phase 4.6 minimal scope; SPEC-AMENDMENT-001 §11 confirmed managers
-- see salary_runs headers but not lines.)

-- ── bonuses_and_perks: read self only ────────────────────────────────────
CREATE POLICY "employee self read" ON "bonuses_and_perks"
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());
--> statement-breakpoint

-- ── employees: read self only via the portal ─────────────────────────────
CREATE POLICY "employee self read" ON "employees"
  FOR SELECT TO authenticated
  USING (id = public.current_employee_id());
--> statement-breakpoint

-- ── entity_contacts / entity_addresses / entity_bank_accounts:
--    employees can read+write their OWN POCs / addresses / banks
--    (entity_type = 'employee' AND entity_id = self)

CREATE POLICY "employee self read" ON "entity_contacts"
  FOR SELECT TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self write" ON "entity_contacts"
  FOR INSERT TO authenticated
  WITH CHECK (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self update" ON "entity_contacts"
  FOR UPDATE TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id())
  WITH CHECK (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint

CREATE POLICY "employee self read" ON "entity_addresses"
  FOR SELECT TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self write" ON "entity_addresses"
  FOR INSERT TO authenticated
  WITH CHECK (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self update" ON "entity_addresses"
  FOR UPDATE TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id())
  WITH CHECK (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint

CREATE POLICY "employee self read" ON "entity_bank_accounts"
  FOR SELECT TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint
CREATE POLICY "employee self write" ON "entity_bank_accounts"
  FOR INSERT TO authenticated
  WITH CHECK (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint

-- ── entity_documents: read OWN signed docs only ──────────────────────────
CREATE POLICY "employee self read" ON "entity_documents"
  FOR SELECT TO authenticated
  USING (entity_type = 'employee' AND entity_id = public.current_employee_id());
--> statement-breakpoint

-- ── entity_activity_log: read events keyed to OR mentioning self ─────────
CREATE POLICY "employee self read" ON "entity_activity_log"
  FOR SELECT TO authenticated
  USING (
    (entity_type = 'employee' AND entity_id = public.current_employee_id())
    OR (payload->'mentions' @>
        jsonb_build_array(jsonb_build_object(
          'entityType','employee',
          'entityId', public.current_employee_id()::text
        ))
       )
  );
