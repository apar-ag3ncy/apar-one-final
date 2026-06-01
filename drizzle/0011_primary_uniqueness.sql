-- 0011_primary_uniqueness — defense-in-depth for the at-most-one-primary
-- invariant on the polymorphic children that carry an is_primary boolean.
--
-- The application layer (server actions in src/lib/server/entities/*)
-- already demotes existing primaries before promoting a new one inside
-- a single transaction. These partial unique indexes are the second
-- guard: even a misbehaving client or a future direct INSERT cannot
-- leave two active primaries for the same (entity_type, entity_id).
--
-- Index condition matches the app's "active row" predicate:
--   is_primary = true AND deleted_at IS NULL
-- so soft-deleted-but-still-primary rows do not block a new primary.
--
-- For entity_contacts and entity_bank_accounts: ONE primary per
-- (entity_type, entity_id).
--
-- For entity_addresses: scope is (entity_type, entity_id) — primary is
-- the "default" address regardless of kind. (If we later need per-kind
-- primaries, drop this index and replace with one keyed on
-- (entity_type, entity_id, kind).)

CREATE UNIQUE INDEX IF NOT EXISTS "entity_contacts_primary_per_entity_unique"
  ON "entity_contacts" ("entity_type", "entity_id")
  WHERE "is_primary" = true AND "deleted_at" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "entity_addresses_primary_per_entity_unique"
  ON "entity_addresses" ("entity_type", "entity_id")
  WHERE "is_primary" = true AND "deleted_at" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "entity_bank_accounts_primary_per_entity_unique"
  ON "entity_bank_accounts" ("entity_type", "entity_id")
  WHERE "is_primary" = true AND "deleted_at" IS NULL;
