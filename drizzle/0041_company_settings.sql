-- 0041_company_settings — Settings → Company details + Billing.
--
-- Adds the agency's own profile fields, bank accounts, and documents so the
-- company can be configured from the UI:
--   * organizations  — add TAN / Udyam / secondary address (GSTIN + PAN + the
--     primary `registered_address` already exist and feed the invoice PDFs).
--   * company_bank_accounts — Apār's own accounts (Title / number / IFSC /
--     bank / branch + one primary). NOT the vault `entity_bank_accounts`: the
--     agency's own numbers go on every invoice and are meant to be copied, so
--     the full number lives on the row.
--   * company_documents — certificates / deeds / rent agreements with the file
--     bytes stored INLINE (bytea). The app runs against vanilla Postgres with
--     no Supabase Storage; these are agency-owned, non-KYC docs meant to be
--     downloaded/viewed, so inline bytes are the portable choice.
--
-- Hand-written (drizzle-kit generate cannot serialise the existing bigint
-- columns in this repo). RLS + service_role policy mirror the sibling tables
-- created by 0036/0037 so production (Supabase) behaves identically.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "tan" text,
  ADD COLUMN IF NOT EXISTS "udyam" text,
  ADD COLUMN IF NOT EXISTS "secondary_address" text;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "company_document_category" AS ENUM (
    'gst', 'tan', 'pan', 'udyam', 'incorporation', 'partnership_deed', 'rent_agreement', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "title" text NOT NULL,
  "account_number" text NOT NULL,
  "ifsc" text NOT NULL,
  "bank_name" text NOT NULL,
  "branch_name" text,
  "is_primary" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "notes" text
);
--> statement-breakpoint

ALTER TABLE "company_bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "company_bank_accounts"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "category" "company_document_category" NOT NULL,
  "title" text NOT NULL,
  "reference_number" text,
  "original_filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "data" bytea NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_documents_category_index"
  ON "company_documents" USING btree ("category");
--> statement-breakpoint

ALTER TABLE "company_documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "company_documents"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Seed role_capabilities for the new `manage_company_profile` capability
-- (mirrors lib/rbac.ts DEFAULT_GRANTS: admin granted, others not; partner
-- always passes via requireCapability short-circuit). Idempotent.
DO $$
DECLARE
  cap text := 'manage_company_profile';
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
