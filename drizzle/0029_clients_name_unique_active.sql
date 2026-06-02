-- Enforce: two active clients can't share a name.
--
-- The OS quick-create modal had no busy guard and the server action had no
-- de-dup check, so a double-submit (or two operators racing) could insert
-- two clients with the same name. The app-side fix prevents the common
-- case; this index closes the race window at the database.
--
-- Partial on (lower(name)) so:
--   - matches the app-side check, which compares with `lower(name)`
--   - only active rows are constrained (archived + soft-deleted rows can
--     keep the name they had, and a freed name is reusable)
--
-- If this migration fails with "could not create unique index ... contains
-- duplicate values", surface the offenders with:
--
--   SELECT lower(name) AS n, array_agg(id) AS ids, count(*) AS c
--   FROM clients
--   WHERE deleted_at IS NULL AND is_archived = false
--   GROUP BY 1 HAVING count(*) > 1;
--
-- …then archive or rename one of each pair before re-running.

CREATE UNIQUE INDEX IF NOT EXISTS clients_name_unique_active
  ON clients (lower(name))
  WHERE deleted_at IS NULL AND is_archived = false;
--> statement-breakpoint
