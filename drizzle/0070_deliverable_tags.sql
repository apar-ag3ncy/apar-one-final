-- 0070_deliverable_tags — two tags on project deliverables (project_tasks).
--
-- 1. priority: Eisenhower tag — 'urgent_important' | 'urgent' | 'important'
--    | 'nice'; NULL = no priority set. Plain text (no enum ALTER); values are
--    validated by the zod schemas in src/lib/server/entities/project-tasks.ts.
-- 2. source: who the deliverable came from — 'apar' | 'vendor'; NULL on
--    legacy rows. New deliverables default to 'apar' in the server action
--    (not here, so existing rows stay untagged).
--
-- Idempotent: IF NOT EXISTS on both columns.

ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "priority" text;
--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "source" text;
