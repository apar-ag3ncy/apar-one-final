-- 0051_company_holidays — company holiday calendar for payroll working-day math.
--
-- Payroll prorates salary by attendance: a month's *working days* = calendar
-- days minus Sundays minus these holidays. HR manages the list in
-- Settings → Holidays. Additive + idempotent; there are no rows yet.
--
-- Partial unique index (deleted_at IS NULL) enforces one *active* holiday per
-- date while allowing a soft-deleted date to be re-added.

CREATE TABLE IF NOT EXISTS company_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  holiday_date date NOT NULL,
  name text NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS company_holidays_date_unique
  ON company_holidays (holiday_date) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- RLS baseline (CLAUDE.md rule #30): default-deny for anon/authenticated; only
-- the service_role (which the app's server connection uses) may touch the table.
ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "service_role all" ON company_holidays;
--> statement-breakpoint
CREATE POLICY "service_role all" ON company_holidays
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
