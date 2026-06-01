-- Adds project attribution to office expenses.
--
-- Before: office_expenses could link to a vendor or an employee (reimbursement)
-- but not to a project. That blocks the Projects window from rolling up real
-- spend per engagement — props, shoot travel, location costs, etc.
--
-- After: office_expenses.project_id is a nullable FK to projects. Nullable
-- because most office overhead (rent, utilities, stationary) has no single
-- project. `set null` on project delete so historical expense rows survive
-- a project hard-delete.

ALTER TABLE office_expenses
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS office_expenses_project_id_index
  ON office_expenses (project_id);
