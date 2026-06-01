-- ───────────────────────────────────────────────────────────────────────────
-- 0008_payroll — Phase 4.5 of the agent-backend brief
-- + SPEC-AMENDMENT-001 §9 (the payroll module).
--
-- Adds:
--   - salary_structures (versioned per employee, capture-not-compute)
--   - salary_runs + salary_lines (with batch flag)
--   - bonuses_and_perks
--   - reimbursements (single-step approval; SPEC-AMENDMENT-001 §14 #5)
--   - leaves (7 kinds confirmed per §14 #4)
--
-- New ledger kinds (`salary_disbursement` + `bonus_payment`) were
-- already added to the transaction_kind enum in 0007_ledger.sql.
--
-- All money columns bigint paise. RLS enabled service-role baseline;
-- per-employee read scope lands in 0009_employee_portal_rls.sql.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."salary_run_status" AS ENUM('draft','posted','reversed');--> statement-breakpoint
CREATE TYPE "public"."bonus_kind" AS ENUM('bonus','perk_cash','perk_inkind','gift','award');--> statement-breakpoint
CREATE TYPE "public"."reimbursement_status" AS ENUM('submitted','approved','rejected','paid');--> statement-breakpoint
CREATE TYPE "public"."reimbursement_attribution" AS ENUM('client','opex');--> statement-breakpoint
CREATE TYPE "public"."leave_kind" AS ENUM('earned','casual','sick','unpaid','comp_off','maternity','paternity');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('applied','approved','rejected','cancelled');
--> statement-breakpoint

CREATE TABLE "salary_structures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "basic_paise" bigint DEFAULT 0 NOT NULL,
  "hra_paise" bigint DEFAULT 0 NOT NULL,
  "special_allowance_paise" bigint DEFAULT 0 NOT NULL,
  "other_allowances" jsonb DEFAULT '[]' NOT NULL,
  "employer_epf_paise" bigint DEFAULT 0 NOT NULL,
  "employer_esi_paise" bigint DEFAULT 0 NOT NULL,
  "ctc_monthly_paise" bigint DEFAULT 0 NOT NULL,
  "source_document_id" uuid REFERENCES "documents"("id") ON DELETE RESTRICT,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "salary_structures_employee_id_effective_from_index" ON "salary_structures" USING btree ("employee_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "salary_structures_employee_id_effective_to_index" ON "salary_structures" USING btree ("employee_id","effective_to");--> statement-breakpoint

CREATE TABLE "salary_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "period_id" uuid NOT NULL REFERENCES "periods"("id") ON DELETE RESTRICT,
  "status" "salary_run_status" DEFAULT 'draft' NOT NULL,
  "posted_at" timestamp with time zone,
  "posted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reversed_at" timestamp with time zone,
  "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "source_document_id" uuid REFERENCES "documents"("id") ON DELETE RESTRICT,
  "per_employee_transactions" text DEFAULT 'true' NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "salary_runs_period_id_index" ON "salary_runs" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "salary_runs_status_index" ON "salary_runs" USING btree ("status");--> statement-breakpoint

CREATE TABLE "salary_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "salary_run_id" uuid NOT NULL REFERENCES "salary_runs"("id") ON DELETE RESTRICT,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "gross_paise" bigint NOT NULL,
  "employee_epf_paise" bigint DEFAULT 0 NOT NULL,
  "employee_esi_paise" bigint DEFAULT 0 NOT NULL,
  "pt_paise" bigint DEFAULT 0 NOT NULL,
  "tds_paise" bigint DEFAULT 0 NOT NULL,
  "other_deductions" jsonb DEFAULT '[]' NOT NULL,
  "net_paise" bigint NOT NULL,
  "payslip_document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
  "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "salary_lines_salary_run_id_index" ON "salary_lines" USING btree ("salary_run_id");--> statement-breakpoint
CREATE INDEX "salary_lines_employee_id_salary_run_id_index" ON "salary_lines" USING btree ("employee_id","salary_run_id");--> statement-breakpoint

CREATE TABLE "bonuses_and_perks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "kind" "bonus_kind" NOT NULL,
  "bonus_date" date NOT NULL,
  "amount_paise" bigint,
  "description" text NOT NULL,
  "source_document_id" uuid REFERENCES "documents"("id") ON DELETE RESTRICT,
  "transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
  "taxable" text DEFAULT 'captured' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bonuses_and_perks_employee_id_bonus_date_index" ON "bonuses_and_perks" USING btree ("employee_id","bonus_date" DESC NULLS LAST);--> statement-breakpoint

CREATE TABLE "reimbursements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "claim_date" date NOT NULL,
  "amount_paise" bigint NOT NULL,
  "attribution" "reimbursement_attribution" NOT NULL,
  "on_behalf_of_client_id" uuid REFERENCES "clients"("id") ON DELETE RESTRICT,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE RESTRICT,
  "description" text NOT NULL,
  "receipt_document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE RESTRICT,
  "status" "reimbursement_status" DEFAULT 'submitted' NOT NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "paid_via_transaction_id" uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
  "notes" text,
  CONSTRAINT "reimbursements_client_attribution_requires_client" CHECK (
    attribution <> 'client' OR on_behalf_of_client_id IS NOT NULL
  )
);
--> statement-breakpoint
CREATE INDEX "reimbursements_employee_id_claim_date_index" ON "reimbursements" USING btree ("employee_id","claim_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reimbursements_status_index" ON "reimbursements" USING btree ("status");--> statement-breakpoint

CREATE TABLE "leaves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "kind" "leave_kind" NOT NULL,
  "from_date" date NOT NULL,
  "to_date" date NOT NULL,
  -- text (not numeric) because the schema avoids Drizzle's Decimal mapping
  -- and the db:check guard bans all fractional types across the board.
  "days" text NOT NULL,
  "status" "leave_status" DEFAULT 'applied' NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "approved_at" timestamp with time zone,
  "notes" text,
  CONSTRAINT "leaves_date_range_ordered" CHECK (to_date >= from_date)
);
--> statement-breakpoint
CREATE INDEX "leaves_employee_id_from_date_index" ON "leaves" USING btree ("employee_id","from_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leaves_status_index" ON "leaves" USING btree ("status");--> statement-breakpoint

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE "salary_structures"  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salary_runs"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salary_lines"       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bonuses_and_perks"  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reimbursements"     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leaves"             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "service_role all" ON "salary_structures" FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "salary_runs"       FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "salary_lines"      FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "bonuses_and_perks" FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "reimbursements"    FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "leaves"            FOR ALL TO service_role USING (true) WITH CHECK (true);
