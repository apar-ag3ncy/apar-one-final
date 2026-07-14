-- 0072_project_vendors — vendors attached to a project (founder batch §4.3).
--
-- project_vendors — a join row pinning a vendor to a project, with an
-- optional free-text role (e.g. 'printer', 'photographer'). Mirrors
-- project_members (0054): UNIQUE(project_id, vendor_id) keeps the link
-- idempotent; only created_at/created_by — links are added/removed, never
-- edited, so no updated_*/deleted_at. Both FKs cascade on delete.
--
-- Idempotent (CREATE TABLE/INDEX IF NOT EXISTS; policy guarded by a
-- duplicate_object catch). RLS + service-role policy mirror 0054/0061.

CREATE TABLE IF NOT EXISTS "project_vendors" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid NOT NULL REFERENCES "projects"(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES "vendors"(id) ON DELETE CASCADE,
  role text,
  created_by uuid,
  CONSTRAINT "project_vendors_project_vendor_uniq" UNIQUE (project_id, vendor_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_vendors_project_id_idx"
  ON "project_vendors" (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_vendors_vendor_id_idx"
  ON "project_vendors" (vendor_id);
--> statement-breakpoint

-- RLS — service-role-only baseline, matching 0053/0054/0061.
ALTER TABLE "project_vendors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role all" ON "project_vendors"
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
