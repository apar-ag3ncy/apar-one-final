-- ───────────────────────────────────────────────────────────────────────────
-- 0006_phase3_seeds_and_triggers — Phase 3 of the agent-backend brief.
--
-- Three concerns:
--
--   1. Seed `role_capabilities` from the lib/rbac.ts default grants. The
--      seed runs once; subsequent edits via the partner-only UI overwrite
--      the rows.
--
--   2. `log_audit_diff()` trigger function + attach to every business table
--      so any INSERT / UPDATE writes a row to `audit_log`. The function
--      runs SECURITY DEFINER so it can write to the append-only table
--      regardless of the caller's role.
--
--   3. `pg_trgm` extension + GIN indexes for Cmd+K search. Supabase has
--      `pg_trgm` pre-installed; CREATE EXTENSION IF NOT EXISTS is idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Extensions ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clients_name_trgm" ON "clients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_name_trgm" ON "vendors" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_full_name_trgm" ON "employees" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_name_trgm" ON "projects" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_contacts_name_trgm" ON "entity_contacts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint

-- ── 2. Diff-trail trigger function ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_audit_diff() RETURNS TRIGGER AS $$
DECLARE
  v_actor_id uuid;
  v_changes jsonb;
  v_entity_id uuid;
BEGIN
  -- Auth context (Supabase exposes auth.uid() inside RLS-aware connections).
  -- Trigger runs in the row's transaction so auth.uid() is the caller.
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  IF (TG_OP = 'INSERT') THEN
    v_entity_id := NEW.id;
    v_changes := jsonb_build_object('after', to_jsonb(NEW));
  ELSIF (TG_OP = 'UPDATE') THEN
    v_entity_id := NEW.id;
    v_changes := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    -- Will never fire on ledger tables (RLS blocks); on entity tables the
    -- service-role policy allows it.
    v_entity_id := OLD.id;
    v_changes := jsonb_build_object('before', to_jsonb(OLD));
  END IF;

  INSERT INTO public.audit_log
    (actor_id, entity_type, entity_id, action, changes)
  VALUES
    (v_actor_id, TG_TABLE_NAME, v_entity_id, lower(TG_OP), v_changes);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

-- ── Attach the trigger to every business table ────────────────────────────

CREATE TRIGGER trg_clients_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_vendors_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_employees_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_projects_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_entity_contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.entity_contacts
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_entity_addresses_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.entity_addresses
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_entity_bank_accounts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.entity_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_entity_tax_identifiers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.entity_tax_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_entity_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.entity_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint
CREATE TRIGGER trg_role_capabilities_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.role_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_diff();
--> statement-breakpoint

-- ── 3. Seed role_capabilities ─────────────────────────────────────────────
-- Partner gets every capability. The `lib/rbac.ts` helper short-circuits
-- so we could skip seeding partner rows, but having them visible in
-- Studio is friendlier and lets the UI render the matrix uniformly.

DO $$
DECLARE
  caps text[] := ARRAY[
    'manage_form_templates','manage_role_capabilities',
    'create_client','update_client','archive_client','restore_client','hard_delete_client',
    'create_vendor','update_vendor','archive_vendor','restore_vendor','hard_delete_vendor',
    'create_employee','update_employee','archive_employee','restore_employee','hard_delete_employee',
    'reveal_kyc','reveal_bank',
    'upload_document','delete_document','hard_delete_document','hard_delete_custom_field',
    'post_transaction','reconcile_transaction','reverse_transaction',
    'manage_users','view_audit_log',
    'manage_periods','close_period','reopen_period',
    'manage_validation_rules','manage_tax_rates',
    'create_journal_voucher','manage_bank_accounts',
    'portal_access',
    'manage_salary_structures','create_salary_run','post_salary_run','reverse_salary_run',
    'view_salary','record_bonus_or_perk',
    'approve_reimbursement','approve_leave','manage_leaves','mark_achievement',
    'manage_user_table_preferences'
  ];
  admin_excludes text[] := ARRAY['manage_role_capabilities','reopen_period'];
  accountant_caps text[] := ARRAY[
    'reveal_bank','post_transaction','reconcile_transaction','reverse_transaction',
    'upload_document','view_audit_log','manage_validation_rules','manage_tax_rates',
    'manage_bank_accounts','view_salary','manage_salary_structures',
    'create_salary_run','post_salary_run','reverse_salary_run','record_bonus_or_perk',
    'approve_reimbursement','manage_user_table_preferences'
  ];
  manager_caps text[] := ARRAY[
    'create_client','update_client','create_vendor','update_vendor',
    'create_employee','update_employee','upload_document','approve_reimbursement',
    'approve_leave','manage_user_table_preferences'
  ];
  employee_caps text[] := ARRAY['upload_document','portal_access','manage_user_table_preferences'];
  viewer_caps text[] := ARRAY['manage_user_table_preferences'];
  cap text;
BEGIN
  FOREACH cap IN ARRAY caps LOOP
    -- partner: always granted
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('partner', cap, true)
    ON CONFLICT (role, capability) DO NOTHING;

    -- admin
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('admin', cap, NOT (cap = ANY(admin_excludes)))
    ON CONFLICT (role, capability) DO NOTHING;

    -- accountant
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('accountant', cap, cap = ANY(accountant_caps))
    ON CONFLICT (role, capability) DO NOTHING;

    -- manager
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('manager', cap, cap = ANY(manager_caps))
    ON CONFLICT (role, capability) DO NOTHING;

    -- employee
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('employee', cap, cap = ANY(employee_caps))
    ON CONFLICT (role, capability) DO NOTHING;

    -- viewer
    INSERT INTO public.role_capabilities (role, capability, granted)
    VALUES ('viewer', cap, cap = ANY(viewer_caps))
    ON CONFLICT (role, capability) DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── 4. auth.users → public.users sync trigger ────────────────────────────
-- When Supabase Auth creates a user (signup / magic link / invite),
-- create a matching public.users row with the default 'employee' role.
-- Partners onboard via direct INSERT in seeds or via a UI under
-- `manage_users`.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, role, full_name, email)
  VALUES (
    NEW.id,
    'employee',
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint

-- Drop the id default so it can only come from auth.users.
ALTER TABLE public.users ALTER COLUMN id DROP DEFAULT;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
