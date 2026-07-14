-- 0071_payroll_grades — founder change-batch §1.1 payroll categories.
--
-- employees.payroll_grade — the salary grade level for the teammate.
-- One nullable text column; the employee *type* is derivable from the
-- grade's first letter, so no second column:
--   Intern    → I
--   Probation → PA, PB, PC, PA+
--   Employee  → EA, EB, EC, EA+
-- Nullable for legacy rows / teammates not yet graded. Values are
-- validated in the app layer (zod enum on create/updateEmployee).

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "payroll_grade" text;
--> statement-breakpoint
