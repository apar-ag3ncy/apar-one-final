-- ───────────────────────────────────────────────────────────────────────────
-- 0001_rls_baseline — Phase 1.6 of the agent-backend brief.
--
-- CLAUDE.md rule #30: RLS on every table, default deny, explicit allow per
-- role. Migration 0000 deferred this. This migration:
--
--   1. Enables RLS on every existing table.
--   2. Adds a single "service_role can do everything" fallback policy on
--      each table. With RLS enabled and only this policy present, normal
--      authenticated users (`anon` / `authenticated`) see zero rows and
--      cannot write — i.e., **default deny** for anyone reachable from the
--      browser.
--   3. Phase 2 + Phase 3 layer per-role / per-capability policies on top.
--
-- Service-role connections (server actions using SUPABASE_SERVICE_ROLE_KEY)
-- bypass RLS by design in Postgres, but Supabase recommends always also
-- writing an explicit `service_role` policy in case a future Postgres
-- upgrade flips the bypass default. We do that here.
--
-- This migration is reversible:
--   ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
-- restores the previous state. No data is moved or transformed.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_activity_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_activity_attendees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── service_role explicit-allow fallback ──────────────────────────────────
-- Drizzle SQL emits one statement per breakpoint; Supabase recommends
-- naming the policy with the operation for readability in the dashboard.

CREATE POLICY "service_role all" ON "activity_log"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "client_activities"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "client_activity_attachments"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "client_activity_attendees"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "client_contacts"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "clients"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "documents"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "organizations"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON "users"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
