-- Projects gain a captured fee column. SPEC-AMENDMENT §0.4 + CLAUDE rule #1:
-- money is bigint paise, never float. Defaults to 0 so existing rows stay
-- valid; the OS ProjectsApp form prompts HR/PM for the SOW amount on
-- create / edit.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS fee_paise bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
