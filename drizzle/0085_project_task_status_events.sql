-- 0085_project_task_status_events — deliverable status history + completion outcome.
--
-- Two things the employee task workspace + the admin project window now need:
--
-- 1. A status-change LOG per deliverable, so the admin sees "who moved this
--    from In progress → Delayed, and when" for every task in a project. Append-
--    only; the ordered rows for a task ARE its history (mirrors
--    project_task_followups, 0076). Employee-driven changes record the
--    employees.id uuid; admin changes record actor_kind='admin' with no uuid
--    (os_users ids are text — the text/uuid trap).
--
-- 2. A stored completion OUTCOME on the task, auto-computed from the completion
--    date vs the due date when the task enters 'done': on_time / slightly_delayed
--    (≤ 3 days late) / delayed (> 3 days late). A task with no due date counts as
--    on_time. This lets the employee overview aggregate "completed on time /
--    slightly delayed / delayed / cancelled" with a plain GROUP BY. NULL while a
--    task is not done; cleared when it leaves 'done'.
--
-- Idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, and the
-- backfill only touches rows whose outcome is still NULL.

CREATE TABLE IF NOT EXISTS "project_task_status_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "project_tasks"(id) ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_kind" text NOT NULL,
  "actor_employee_id" uuid REFERENCES "employees"(id) ON DELETE SET NULL,
  "actor_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_status_events_task_id_idx" ON "project_task_status_events" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_status_events_actor_employee_id_idx" ON "project_task_status_events" ("actor_employee_id");
--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "completion_outcome" text;
--> statement-breakpoint
UPDATE "project_tasks" SET "completion_outcome" = CASE
    WHEN "due_on" IS NULL THEN 'on_time'
    WHEN ("completed_at" AT TIME ZONE 'Asia/Kolkata')::date <= "due_on" THEN 'on_time'
    WHEN ("completed_at" AT TIME ZONE 'Asia/Kolkata')::date <= "due_on" + 3 THEN 'slightly_delayed'
    ELSE 'delayed'
  END
  WHERE "status" = 'done' AND "completed_at" IS NOT NULL AND "completion_outcome" IS NULL;
