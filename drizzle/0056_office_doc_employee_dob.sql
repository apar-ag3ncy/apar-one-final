-- 0056_office_doc_employee_dob — attach an invoice document to office
-- expenses, and record an employee's date of birth.
--
-- office_expenses.document_id points a capture row at its uploaded bill /
-- receipt in the documents table. Nullable — capture-only rows stay
-- unlinked. ON DELETE SET NULL so a document hard-delete never orphans the
-- expense; the app also nulls this when an invoice is removed.
--
-- employees.date_of_birth — optional DOB (date, no time). Nullable for
-- legacy rows and employees who haven't supplied it.

ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "document_id" uuid REFERENCES "documents"(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "office_expenses_document_id_idx"
  ON "office_expenses" (document_id);
--> statement-breakpoint

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "date_of_birth" date;
--> statement-breakpoint
