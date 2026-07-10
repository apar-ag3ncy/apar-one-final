-- 0066_os_users — server-backed OS user accounts (the /os lock-screen login).
--
-- Previously OS accounts lived only in the creating browser's localStorage, so
-- a user made on one device could not be signed into from another. This table
-- persists them server-side. Passwords are scrypt-hashed by
-- src/lib/server/os-auth.ts (never plaintext). The built-in super admin
-- (id 'super-admin', username 'apar') is upserted on demand by
-- ensureOsSuperAdmin(), so it always exists even on a fresh DB.
--
-- id is a plain text PK ('super-admin' for the built-in, 'u-<hex>' for the
-- rest). permissions is the opaque OS RBAC map stored verbatim.

CREATE TABLE IF NOT EXISTS "os_users" (
  "id" text PRIMARY KEY NOT NULL,
  "username" text NOT NULL,
  "full_name" text NOT NULL,
  "password_hash" text NOT NULL,
  "role" text NOT NULL DEFAULT 'admin',
  "tone" text NOT NULL DEFAULT '#B5391E',
  "permissions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "os_users_username_lower_unique"
  ON "os_users" (lower("username"))
  WHERE "deleted_at" IS NULL;
