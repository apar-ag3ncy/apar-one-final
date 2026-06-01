-- ───────────────────────────────────────────────────────────────────────────
-- 0005_phase2_rls — Phase 2 of the agent-backend brief.
--
-- Enable RLS on every Phase 2 table with a service-role-only baseline.
-- Per-role / per-capability policies layer in Phase 3 alongside the
-- `lib/rbac.ts` enforcement helpers.
--
-- Exceptions:
--   - `entity_activity_log` and `form_field_changes` are append-only
--     audit-style tables — INSERT + SELECT only, no UPDATE / DELETE
--     policies. Mirrors the `audit_log` pattern from 0002.
-- ───────────────────────────────────────────────────────────────────────────

-- ── ENABLE RLS ────────────────────────────────────────────────────────────

ALTER TABLE "vendors"                 ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees"               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects"                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_contacts"         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_addresses"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_bank_accounts"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_tax_identifiers"  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_documents"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_relationships"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_custom_values"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_activity_log"     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates"          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_fields"             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_field_changes"      ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_capabilities"       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_table_preferences"  ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── Service-role-all policy on the read/write tables ──────────────────────

CREATE POLICY "service_role all" ON "vendors"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "employees"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "projects"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_contacts"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_addresses"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_bank_accounts"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_tax_identifiers"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_documents"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_relationships"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "entity_custom_values"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "form_templates"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "form_fields"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "role_capabilities"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "user_table_preferences"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint

-- ── Append-only tables: INSERT + SELECT only ──────────────────────────────

CREATE POLICY "service_role insert" ON "entity_activity_log"
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role select" ON "entity_activity_log"
  AS PERMISSIVE FOR SELECT TO service_role USING (true);--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "entity_activity_log" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "entity_activity_log" FROM authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "entity_activity_log" FROM anon;--> statement-breakpoint

CREATE POLICY "service_role insert" ON "form_field_changes"
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role select" ON "form_field_changes"
  AS PERMISSIVE FOR SELECT TO service_role USING (true);--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "form_field_changes" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "form_field_changes" FROM authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "form_field_changes" FROM anon;
