-- Enforce: two active clients can't share a name.
--
-- Step 1: clean up existing duplicates. Inside each set of active
--   clients sharing a lower(name), keep the oldest row (smallest
--   `created_at`; tie-break on `id`) and archive every other. We use
--   the regular soft-archive path (`is_archived = true`, `archived_at`
--   set, `archived_by` left NULL to mark "system / migration") so the
--   rows stay recoverable — to find what this migration touched:
--
--     SELECT id, name, archived_at FROM clients
--     WHERE archived_by IS NULL
--       AND archived_at >= '2026-06-02'::date;
--
-- Step 2: create the partial unique index. lower(name) so the check
--   matches the app-side de-dup in `createClient`; partial on
--   active-only rows so archived/deleted clients can keep their names
--   and a freed name remains reusable.

DO $$
DECLARE
  archived_count integer;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY lower(name)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM clients
    WHERE deleted_at IS NULL AND is_archived = false
  ),
  to_archive AS (
    SELECT id FROM ranked WHERE rn > 1
  )
  UPDATE clients c
  SET
    is_archived = true,
    archived_at = now(),
    updated_at = now()
  FROM to_archive
  WHERE c.id = to_archive.id;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  IF archived_count > 0 THEN
    RAISE NOTICE
      'clients_name_unique_active: auto-archived % duplicate active client(s); kept the oldest in each group',
      archived_count;
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS clients_name_unique_active
  ON clients (lower(name))
  WHERE deleted_at IS NULL AND is_archived = false;
--> statement-breakpoint
