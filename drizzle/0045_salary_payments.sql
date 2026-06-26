-- 0045_salary_payments — record individual salary disbursements per employee.
--
-- Standalone capture of "salary given out" (amount + date), shown in the
-- employee Compensation tab. The cumulative total is surfaced in the Office
-- app and deducted from the Office Ledger's net cash position. Deliberately
-- NOT wired into the double-entry ledger — a lightweight tracker per product
-- decision; the salary_runs / salary_lines path stays the route for that.
--
-- All money columns bigint paise. RLS enabled, service-role baseline (mirrors
-- the rest of the payroll tables in 0008_payroll.sql).
CREATE TABLE "salary_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
  "paid_on" date NOT NULL,
  "amount_paise" bigint NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "salary_payments_employee_id_paid_on_index" ON "salary_payments" USING btree ("employee_id","paid_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "salary_payments_paid_on_index" ON "salary_payments" USING btree ("paid_on");--> statement-breakpoint
ALTER TABLE "salary_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "service_role all" ON "salary_payments" FOR ALL TO service_role USING (true) WITH CHECK (true);
