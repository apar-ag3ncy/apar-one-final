-- 0051_fixed_assets — fixed-asset register + the depreciation accounts.
--
-- Capitalised purchases already debit 1510 Office Equipment & Assets (vendor
-- bill, attribution='asset'). This adds:
--   1. Two GL accounts so depreciation can post:
--        1590 Accumulated Depreciation (contra-asset; credit balance nets 1510)
--        6500 Depreciation                (operating expense)
--   2. fixed_assets — one row per asset, straight-line. A depreciation run posts
--        Dr 6500 / Cr 1590 for the period and rolls accumulated_depreciation +
--        depreciation_through forward on each asset.
INSERT INTO accounts (code, name, type, is_control, subledger_kind) VALUES
  ('1590', 'Accumulated Depreciation', 'asset',   false, NULL),
  ('6500', 'Depreciation',             'expense', false, NULL)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
CREATE TYPE fixed_asset_status AS ENUM ('active', 'fully_depreciated', 'disposed');
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "category" text,
  "acquisition_date" date NOT NULL,
  "cost_paise" bigint NOT NULL,
  "salvage_value_paise" bigint NOT NULL DEFAULT 0,
  "useful_life_months" integer NOT NULL,
  "accumulated_depreciation_paise" bigint NOT NULL DEFAULT 0,
  "depreciation_through" date,
  "status" "fixed_asset_status" NOT NULL DEFAULT 'active',
  "source_bill_txn_id" uuid REFERENCES "transactions"("id") ON DELETE set null,
  "notes" text,
  CONSTRAINT "fixed_assets_life_positive" CHECK ("useful_life_months" > 0),
  CONSTRAINT "fixed_assets_cost_nonneg" CHECK ("cost_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets" ("status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "fixed_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "fixed_assets"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
