-- 0073_task_vendor_assignees — deliverable assignees can be vendors, not just
-- employees (founder batch: source-aware assignee picker).
--
-- project_task_assignees (0061) linked task → employee only (employee_id NOT
-- NULL). A deliverable tagged source='vendor' (0070) is worked by a project
-- vendor (0072), so the join row must be able to point at a vendor instead.
--
-- We relax employee_id to nullable, add vendor_id, and require exactly one of
-- the two via a CHECK (num_nonnulls(...) = 1). The existing
-- UNIQUE(task_id, employee_id) stays: with employee_id nullable, vendor rows
-- (employee_id NULL) don't collide there — SQL treats NULLs as distinct in a
-- plain UNIQUE — so a partial UNIQUE(task_id, vendor_id) keeps vendor links
-- idempotent on their own.
--
-- Idempotent: DROP NOT NULL is a no-op if already dropped; ADD COLUMN IF NOT
-- EXISTS; the CHECK is dropped-then-added; indexes are IF NOT EXISTS.

ALTER TABLE "project_task_assignees" ALTER COLUMN "employee_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_task_assignees" ADD COLUMN IF NOT EXISTS "vendor_id" uuid REFERENCES "vendors"(id) ON DELETE CASCADE;
--> statement-breakpoint
-- exactly one of employee_id / vendor_id set
ALTER TABLE "project_task_assignees" DROP CONSTRAINT IF EXISTS "project_task_assignees_one_assignee";
--> statement-breakpoint
ALTER TABLE "project_task_assignees" ADD CONSTRAINT "project_task_assignees_one_assignee" CHECK (num_nonnulls("employee_id","vendor_id") = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_task_assignees_task_vendor_uniq" ON "project_task_assignees" ("task_id","vendor_id") WHERE "vendor_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_assignees_vendor_id_idx" ON "project_task_assignees" ("vendor_id");
