-- ───────────────────────────────────────────────────────────────────────────
-- 0002_audit_log_append_only — Phase 1.7 of the agent-backend brief.
--
-- Two concerns folded into one migration because they are inseparable:
--
--   1. Rename `activity_log` → `audit_log`. The existing table from 0000_init
--      is the *diff trail* (CLAUDE.md rule #38); SPEC-AMENDMENT-001 §4
--      reserves `entity_activity_log` for the *typed event stream* shown on
--      profiles, which lands in Phase 2. Removing the name collision before
--      Phase 2 saves us from a renaming dance against frontend code that
--      doesn't exist yet.
--
--   2. Make `audit_log` truly append-only. The standard pattern: ENABLE RLS,
--      then ONLY a service-role INSERT policy. No UPDATE policy, no DELETE
--      policy — RLS's default deny does the work. Service-role connections
--      bypass RLS in Postgres, so we ALSO write an explicit revoke on
--      UPDATE/DELETE for `public` to make the intent legible in pgAdmin /
--      Studio. The triggers (Phase 3) will use a `SECURITY DEFINER` function
--      owned by a dedicated role, so the trigger can insert without
--      needing a permissive INSERT policy here.
--
-- ───────────────────────────────────────────────────────────────────────────

-- ── Rename + carry indexes ───────────────────────────────────────────────
-- Postgres auto-renames the indexes when you rename the table; but the
-- index names contain "activity_log_*" so we explicitly rename them too
-- for legibility in Studio / pg_indexes.

ALTER TABLE "activity_log" RENAME TO "audit_log";--> statement-breakpoint

ALTER INDEX "activity_log_entity_type_entity_id_created_at_index"
  RENAME TO "audit_log_entity_type_entity_id_created_at_index";
--> statement-breakpoint

ALTER INDEX "activity_log_actor_id_created_at_index"
  RENAME TO "audit_log_actor_id_created_at_index";
--> statement-breakpoint

-- ── The previous migration's service-role-all policy moves with the rename
-- (policies are attached to the table OID). We need to replace it with the
-- append-only variant.

DROP POLICY IF EXISTS "service_role all" ON "audit_log";--> statement-breakpoint

-- ── Append-only policy set ───────────────────────────────────────────────
-- Service role can INSERT and SELECT. No UPDATE, no DELETE policy —
-- RLS default-deny blocks them for everyone. The trigger function in
-- Phase 3 will run as SECURITY DEFINER so it inserts via the elevated
-- owner, not the caller's role.

CREATE POLICY "service_role insert" ON "audit_log"
  AS PERMISSIVE FOR INSERT TO service_role WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY "service_role select" ON "audit_log"
  AS PERMISSIVE FOR SELECT TO service_role USING (true);
--> statement-breakpoint

-- ── Belt-and-suspenders for the case a future Postgres upgrade flips
-- the service_role RLS-bypass default. Revoke UPDATE/DELETE/TRUNCATE at
-- the SQL grant layer too. SELECT/INSERT stay grantable (the policies
-- above gate them).

REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM anon;
