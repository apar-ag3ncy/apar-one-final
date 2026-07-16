-- 0077_project_priority_external_department — project-level priority + external
-- flag + department focus (§4.2), plus a project follow-up thread and a
-- completed-date backfill for the avg-turnover dashboard tile (§2.2.8).
--
-- • priority: urgent/high/normal/low (text + CHECK, mirrors project_tasks
--   priority; no pgEnum churn). External projects are floated up in the board
--   by a sort rule, not a stored priority mutation.
-- • is_external: whether the deliverable/project came from outside Apar.
-- • department: the owning department, for the department-wise focus view.
-- • project_followups: a follow-up thread on the project itself — auto-appended
--   on a priority change (POC to follow up) and manually addable. Mirrors
--   project_task_followups (0076) with an extra `kind` column.
-- • completed_on already exists (never populated); backfill approximates it as
--   updated_at for already-completed rows so avg turnover has data on day one.
--
-- Idempotent: ADD COLUMN / CREATE … IF NOT EXISTS + a duplicate-safe CHECK.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "priority" text NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_external" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "department" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects" ADD CONSTRAINT "projects_priority_check" CHECK ("priority" IN ('urgent','high','normal','low'));
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_priority_idx" ON "projects" ("priority");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_department_idx" ON "projects" ("department");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_followups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "note" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'note',
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_followups_project_id_idx" ON "project_followups" ("project_id");
--> statement-breakpoint
UPDATE "projects"
  SET "completed_on" = ("updated_at")::date
  WHERE "status" = 'completed'
    AND "completed_on" IS NULL
    AND "deleted_at" IS NULL;
