-- 0065_office_seed_categories — seed "Softwares" and "Assets" as custom
-- office-expense categories (user decision: group existing built-ins into
-- display buckets; Softwares/Assets are their own buckets, shown separately).
--
-- Seeded as office_expense_categories rows rather than enum values because:
--   (1) debitAccountFor() (src/lib/server/entities/office-expenses.ts) already
--       capitalizes custom categories named ~* 'asset' to 1510 Office
--       Equipment & Assets — the seeded "Assets" bucket posts correctly with
--       zero code changes;
--   (2) custom categories already flow through the picker, chips, summary and
--       management UI — no plumbing;
--   (3) enum ADD VALUE is permanent; a seeded row can be renamed/archived.
--
-- Idempotent (INSERT … WHERE NOT EXISTS on lower(name) among live rows,
-- matching the partial unique index from 0053). created_by is nullable; RLS
-- is service-role-only, so plain inserts are fine.

INSERT INTO "office_expense_categories" (name, color, hint)
SELECT 'Softwares', '#3F4E8E', 'SaaS subscriptions, licenses, tools'
WHERE NOT EXISTS (
  SELECT 1 FROM "office_expense_categories"
  WHERE lower(name) = 'softwares' AND deleted_at IS NULL
);
--> statement-breakpoint
INSERT INTO "office_expense_categories" (name, color, hint)
SELECT 'Assets', '#2D8A8A', 'Capitalized equipment — posts to 1510'
WHERE NOT EXISTS (
  SELECT 1 FROM "office_expense_categories"
  WHERE lower(name) = 'assets' AND deleted_at IS NULL
);
--> statement-breakpoint
