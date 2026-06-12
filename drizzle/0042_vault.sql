-- 0042_vault — Settings → Vault (password-protected credential store).
--
-- Stores the agency's account IDs + passwords. Secrets are encrypted at rest
-- with AES-256-GCM under a random data-encryption key (DEK); the DEK is
-- wrapped by a key derived (scrypt) from the user-chosen VAULT PASSWORD.
-- Without the vault password the server cannot decrypt anything — "password
-- protection to view" is cryptographic, not just a UI gate.
--
--   * vault_settings — singleton: scrypt salt + params and the wrapped DEK.
--     The GCM auth tag on the wrapped DEK doubles as the password verifier
--     (unwrap fails on a wrong password), so no separate hash is stored.
--   * vault_items — one credential each. `title` stays plaintext for the
--     locked list; username/password/url/notes live in the encrypted blob.
--
-- Hand-written (drizzle-kit generate cannot serialise the existing bigint
-- columns in this repo). RLS + service_role policy mirror 0041's tables.
--
-- ⚠ NEVER attach log_audit_diff() (0034) or any row-snapshotting trigger to
-- vault_settings or vault_items: the trigger would copy wrapped_dek/kdf_salt
-- and item ciphertext into the append-only audit_log, where an archived old
-- wrap plus a retired password recovers the DEK forever. App-level logAudit
-- in src/lib/server/settings/vault.ts (events + titles only) is the intended
-- audit path for these tables.

CREATE TABLE IF NOT EXISTS "vault_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "kdf_salt" bytea NOT NULL,
  "kdf_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "wrapped_dek" bytea NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone
);
--> statement-breakpoint

-- One live vault only — closes the setupVault check-then-insert race.
CREATE UNIQUE INDEX IF NOT EXISTS "vault_settings_singleton"
  ON "vault_settings" ((true)) WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "vault_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "vault_settings"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vault_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "title" text NOT NULL,
  "data" bytea NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_items_title_index"
  ON "vault_items" USING btree ("title");
--> statement-breakpoint

ALTER TABLE "vault_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "vault_items"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Seed role_capabilities for the new `manage_vault` capability (mirrors
-- lib/rbac.ts DEFAULT_GRANTS: admin granted, others not; partner always
-- passes via the requireCapability short-circuit). Idempotent.
DO $$
DECLARE
  cap text := 'manage_vault';
BEGIN
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('partner', cap, true) ON CONFLICT (role, capability) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('admin', cap, true) ON CONFLICT (role, capability) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('accountant', cap, false) ON CONFLICT (role, capability) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('manager', cap, false) ON CONFLICT (role, capability) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('employee', cap, false) ON CONFLICT (role, capability) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability, granted)
  VALUES ('viewer', cap, false) ON CONFLICT (role, capability) DO NOTHING;
END $$;
