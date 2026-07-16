-- 0076_project_task_followups — a follow-up thread on a deliverable (§7).
-- For any task handed to a vendor, the founder wants to record follow-ups with
-- notes and keep a complete history thread. Each row is one note; the ordered
-- list of notes for a task IS the thread. Notes are added, never edited, so the
-- table carries only `createdBy` + `createdAt` (mirrors project_task_assignees,
-- 0073). FK cascades so deleting a task drops its thread.
--
-- Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "project_task_followups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "project_tasks"(id) ON DELETE CASCADE,
  "note" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_followups_task_id_idx" ON "project_task_followups" ("task_id");
