-- 0063_entity_codes — human-readable display codes for clients, vendors and
-- projects (employees already carry employee_code, 0016-era).
--
-- clients.code  'CL-0001', vendors.code 'VN-0001' — NOT NULL + unique after
-- backfill; generated at create time by the server action (regex scan max+1,
-- unique index is the race arbiter — same pattern as nextEmployeeCode()).
-- Backfill orders by (created_at, id) so codes follow signup order.
--
-- projects.code stays nullable-in-schema (user may type a custom code like
-- 'LODHA-DIWALI-26'), but every NULL is backfilled with the next 'PRJ-NNNN'
-- and the create action auto-fills blanks from now on. The unique index is
-- PARTIAL on the auto pattern only, so free-form user codes are allowed to
-- repeat across archived/live rows exactly as before.

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "code" text;
--> statement-breakpoint
UPDATE "clients" SET code = 'CL-' || lpad(t.rn::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM "clients"
) t
WHERE "clients".id = t.id AND "clients".code IS NULL;
--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "code" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_code_unique" ON "clients" (code);
--> statement-breakpoint

ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "code" text;
--> statement-breakpoint
UPDATE "vendors" SET code = 'VN-' || lpad(t.rn::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM "vendors"
) t
WHERE "vendors".id = t.id AND "vendors".code IS NULL;
--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "code" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_code_unique" ON "vendors" (code);
--> statement-breakpoint

-- Projects: fill NULL codes continuing after the existing max of the auto
-- series (user-typed codes that happen to match 'PRJ-N' count toward the max
-- so we never collide with them).
UPDATE "projects" SET code = 'PRJ-' || lpad((base.maxn + t.rn)::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM "projects" WHERE code IS NULL
) t,
(
  SELECT COALESCE(MAX((regexp_match(code, '^PRJ-(\d+)$'))[1]::int), 0) AS maxn
  FROM "projects" WHERE code IS NOT NULL
) base
WHERE "projects".id = t.id AND "projects".code IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_auto_code_unique"
  ON "projects" (code) WHERE code ~ '^PRJ-[0-9]+$';
--> statement-breakpoint
