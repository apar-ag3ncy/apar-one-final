-- 0075_project_task_statuses — three extra selectable deliverable statuses
-- (§6b). The founder wants six manual statuses: To do, In progress, Completed,
-- Little delayed, Delayed, Cancelled.
--
-- The existing enum value 'done' is KEPT (a rename is risky); the UI simply
-- labels it "Completed". We only ADD three new values. `completedAt` stays
-- keyed to 'done' — the delayed statuses are still OPEN, not completed.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op when the label already
-- exists, so a re-run is safe.

ALTER TYPE "project_task_status" ADD VALUE IF NOT EXISTS 'little_delayed';
--> statement-breakpoint
ALTER TYPE "project_task_status" ADD VALUE IF NOT EXISTS 'delayed';
--> statement-breakpoint
ALTER TYPE "project_task_status" ADD VALUE IF NOT EXISTS 'cancelled';
