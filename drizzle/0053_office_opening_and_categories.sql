-- 0053_office_opening_and_categories — opening-balances equity account +
-- user-defined office-expense categories.
--
-- (1) New account 3900 Opening Balance Equity (equity, NOT control). The
--     opening-balances journal credits/debits this account so the opening
--     JV balances without touching P&L. Mirrors 0049's "INSERT only if
--     missing" pattern so re-applying is a no-op on prod.
--     NOTE: code 3900 is the same code the existing bank opening-balance
--     flow (src/lib/server/billing/agency-banks.ts::postOpeningJv) already
--     credits — but which was never seeded, so that path would have thrown
--     "account 3900 not found". Seeding it here also repairs that reference.
-- (2) office_expense_categories — user-defined custom buckets that sit
--     alongside the fixed `office_expense_category` enum. When an expense
--     is filed under category='other', the OS Office app can pin it to one
--     of these rows via office_expenses.custom_category_id.
--
-- Column style mirrors office_expenses (0017): timestamps()/auditColumns()
-- render to id/created_at/updated_at/deleted_at + created_by/updated_by.

INSERT INTO "accounts" (code, name, type, is_control, subledger_kind)
SELECT '3900', 'Opening Balance Equity', 'equity', false, NULL
WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE code = '3900');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "office_expense_categories" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  name text NOT NULL,
  color text,
  hint text
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "office_expense_categories_name_lower_uniq"
  ON "office_expense_categories" (lower(name)) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "custom_category_id" uuid
    REFERENCES "office_expense_categories"(id);
--> statement-breakpoint
ALTER TABLE "office_expenses"
  ADD COLUMN IF NOT EXISTS "category_note" text;
--> statement-breakpoint

-- RLS — service-role-only baseline, matching office_expenses (0017).
ALTER TABLE "office_expense_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service_role all" ON "office_expense_categories"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
--> statement-breakpoint
