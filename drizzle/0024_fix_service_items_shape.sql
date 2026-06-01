-- Phase 2 fix-up — align the service_items SQL DDL with what the Drizzle
-- schema file actually declares.
--
-- 0019_billing_phase1.sql created service_items with
--   default_income_account_id uuid REFERENCES accounts(id)
--   default_gst_rate_bps integer       (nullable)
--
-- The Drizzle TS schema (src/lib/db/schema/service_items.ts), which is
-- the source of truth for type inference and runtime queries, instead
-- declares:
--   default_posting_account_code text NOT NULL DEFAULT '4100'
--   default_gst_rate_bps integer    NOT NULL DEFAULT 1800
--
-- The two diverged because the TS file was edited (replacing the FK
-- with a text code, mirroring invoice_lines.posting_account_code) after
-- the SQL was written but before commit. Server actions written against
-- the TS schema would silently break against the SQL DDL.
--
-- This migration brings the DB in line with the TS schema. Safe to run
-- because 0019 hasn't been applied to any production DB yet — the
-- column being dropped has no data. The TS schema (and downstream
-- 0021_billing_reference_seeds, which inserts into
-- default_income_account_id) gets a corresponding fix here.

-- 1. Drop the unused FK column and add the text-code column. If the
--    column was never created (re-running migrations), DROP IF EXISTS
--    keeps this idempotent. ADD COLUMN IF NOT EXISTS likewise.
ALTER TABLE service_items
  DROP COLUMN IF EXISTS default_income_account_id;
--> statement-breakpoint

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS default_posting_account_code text NOT NULL DEFAULT '4100';
--> statement-breakpoint

-- 2. default_gst_rate_bps: NOT NULL with default 1800. Backfill any
--    existing NULLs to 1800 first so the SET NOT NULL doesn't fail.
UPDATE service_items SET default_gst_rate_bps = 1800 WHERE default_gst_rate_bps IS NULL;
--> statement-breakpoint

ALTER TABLE service_items
  ALTER COLUMN default_gst_rate_bps SET DEFAULT 1800;
--> statement-breakpoint

ALTER TABLE service_items
  ALTER COLUMN default_gst_rate_bps SET NOT NULL;
--> statement-breakpoint

-- 3. Reseed the SAC catalog rows under the new shape. The 0021 seeds
--    targeted default_income_account_id (now dropped) so the rows
--    would have been INSERTed with that column = NULL. The
--    default_posting_account_code defaults to '4100' which is correct
--    for the catalog. Idempotent via ON CONFLICT (name).

INSERT INTO service_items (
  sac_code, name, description,
  default_rate_paise, default_unit,
  default_posting_account_code,
  default_gst_rate_bps, default_tds_section,
  is_active
) VALUES
  ('998361', 'Advertising Services',
   'Conceptualisation, creative, copy, media planning, campaign execution.',
   NULL, NULL, '4100', 1800, '194C', true),
  ('998363', 'Advertising Space (Print / Outdoor)',
   'Buying / reselling advertising space in newspapers, magazines, hoardings, transit, cinema.',
   NULL, NULL, '4100', 1800, '194C', true),
  ('998391', 'Specialty Design Services',
   'Branding, identity, graphic design, packaging, environmental design.',
   NULL, NULL, '4100', 1800, '194J', true),
  ('998311', 'Management Consulting Services',
   'Strategy, market research, brand strategy, organisational consulting.',
   NULL, 'hour', '4100', 1800, '194J', true),
  ('998313', 'IT Consulting & Support Services',
   'Digital / website / tech-stack consulting; not classified as advertising.',
   NULL, 'hour', '4100', 1800, '194J', true),
  ('998399', 'Other Professional, Technical & Business Services',
   'Catch-all for retainers, fractional services, advisory engagements that do not fit other SACs.',
   NULL, NULL, '4100', 1800, '194J', true)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
