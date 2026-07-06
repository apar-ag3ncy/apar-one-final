-- 0054_project_members_tasks — project team membership + per-project task
-- board.
--
-- (1) project_members — a join row pinning an employee to a project as a
--     team member (with an optional free-text role note). Distinct from
--     projects.lead_employee_id (the single project lead). UNIQUE(project_id,
--     employee_id) keeps membership idempotent. Only created_at/created_by —
--     memberships are added/removed, never edited, so no updated_*/deleted_at.
-- (2) project_tasks — a lightweight task board scoped to one project. Tasks
--     move through todo → in_progress → done; completed_at is stamped when a
--     task enters 'done'. Soft-delete via deleted_at. assignee_employee_id
--     points the task at a team member (nullable; SET NULL on employee delete).
--
-- Column style mirrors office_expenses (0017)/projects (0016): full
-- timestamps()/auditColumns() on project_tasks; project_members declares its
-- reduced column set (created_at + created_by only) explicitly.
--
-- Idempotent (CREATE TABLE/TYPE/INDEX IF NOT EXISTS; enum guarded by a
-- pg_type lookup since Postgres has no CREATE TYPE IF NOT EXISTS). RLS +
-- service-role policy mirror 0053.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_task_status') THEN
    CREATE TYPE project_task_status AS ENUM ('todo', 'in_progress', 'done');
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_members" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid NOT NULL REFERENCES "projects"(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES "employees"(id) ON DELETE CASCADE,
  role_note text,
  created_by uuid,
  CONSTRAINT "project_members_project_employee_uniq" UNIQUE (project_id, employee_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_members_project_id_idx"
  ON "project_members" (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_members_employee_id_idx"
  ON "project_members" (employee_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_tasks" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  project_id uuid NOT NULL REFERENCES "projects"(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status project_task_status NOT NULL DEFAULT 'todo',
  assignee_employee_id uuid REFERENCES "employees"(id) ON DELETE SET NULL,
  due_on date,
  position integer NOT NULL DEFAULT 0,
  completed_at timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_tasks_project_id_idx"
  ON "project_tasks" (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_assignee_employee_id_idx"
  ON "project_tasks" (assignee_employee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_status_idx"
  ON "project_tasks" (status);
--> statement-breakpoint

-- RLS — service-role-only baseline, matching office_expenses (0017)/0053.
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "project_members"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "project_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "project_tasks"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
--> statement-breakpoint
