-- 0061_project_structure — sub-projects, client-side POC, deliverable
-- categories and multi-assignee deliverables.
--
-- (1) projects.parent_project_id — one-level sub-projects. A sub-project is a
--     full project row (own fee, team, deliverables) pinned under a parent.
--     RESTRICT on delete: a parent with children can't be hard-deleted until
--     the children go first (mirrors the clients FK stance). A trigger
--     enforces single-level nesting + client inheritance at the DB, so no
--     code path can create grandchildren or cross-client subs.
-- (2) projects.client_contact_id — the client-side POC for this project,
--     one of the client's entity_contacts rows. SET NULL on contact delete;
--     purely informational, so losing it never blocks anything.
-- (3) deliverable_categories — GLOBAL user-defined buckets for deliverables
--     (project tasks). Apply across all projects. Soft-delete via deleted_at;
--     unique on lower(name) among live rows (mirrors
--     office_expense_categories, 0053).
-- (4) project_tasks.category_id — pins a deliverable to a category.
--     SET NULL on category delete so archiving a category never breaks a
--     board.
-- (5) project_task_assignees — many-to-many deliverable ↔ employee. Replaces
--     the single project_tasks.assignee_employee_id (kept in place for now;
--     the app stops reading/writing it — dropped in a later cleanup once
--     verified). Backfilled below. Add/remove-only rows: created_at +
--     created_by, mirroring project_members (0054).
--
-- Idempotent DDL throughout; RLS + service-role policy mirror 0054.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "parent_project_id" uuid REFERENCES "projects"(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "client_contact_id" uuid REFERENCES "entity_contacts"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_parent_project_id_idx"
  ON "projects" (parent_project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_client_contact_id_idx"
  ON "projects" (client_contact_id);
--> statement-breakpoint

-- One-level nesting + client inheritance. BEFORE trigger so bad rows never
-- land. Four rules:
--   a) no self-parenting;
--   b) the parent must itself be top-level (no grandchildren);
--   c) a project that already has children cannot become a sub-project;
--   d) a sub-project must share its parent's client.
CREATE OR REPLACE FUNCTION tg_projects_one_level_nesting()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_project_id IS NOT NULL THEN
    IF NEW.parent_project_id = NEW.id THEN
      RAISE EXCEPTION 'project % cannot be its own parent', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM projects
      WHERE id = NEW.parent_project_id AND parent_project_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'parent project % is itself a sub-project; nesting is one level deep', NEW.parent_project_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM projects WHERE parent_project_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'project % has sub-projects and cannot become a sub-project itself', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT client_id FROM projects WHERE id = NEW.parent_project_id) IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'sub-project must share its parent''s client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_one_level_nesting ON "projects";
--> statement-breakpoint
CREATE TRIGGER projects_one_level_nesting
  BEFORE INSERT OR UPDATE OF parent_project_id, client_id ON "projects"
  FOR EACH ROW EXECUTE FUNCTION tg_projects_one_level_nesting();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "deliverable_categories" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  name text NOT NULL,
  color text,
  position integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deliverable_categories_name_lower_uniq"
  ON "deliverable_categories" (lower(name)) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "category_id" uuid REFERENCES "deliverable_categories"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_tasks_category_id_idx"
  ON "project_tasks" (category_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_task_assignees" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  task_id uuid NOT NULL REFERENCES "project_tasks"(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES "employees"(id) ON DELETE CASCADE,
  created_by uuid,
  CONSTRAINT "project_task_assignees_task_employee_uniq" UNIQUE (task_id, employee_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_assignees_task_id_idx"
  ON "project_task_assignees" (task_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_assignees_employee_id_idx"
  ON "project_task_assignees" (employee_id);
--> statement-breakpoint

-- Backfill: every existing single assignee becomes a join row. Idempotent.
INSERT INTO "project_task_assignees" (task_id, employee_id, created_by)
SELECT id, assignee_employee_id, created_by
FROM "project_tasks"
WHERE assignee_employee_id IS NOT NULL
ON CONFLICT ON CONSTRAINT "project_task_assignees_task_employee_uniq" DO NOTHING;
--> statement-breakpoint

-- RLS — service-role-only baseline, matching 0053/0054.
ALTER TABLE "deliverable_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role all" ON "deliverable_categories"
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

ALTER TABLE "project_task_assignees" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role all" ON "project_task_assignees"
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
