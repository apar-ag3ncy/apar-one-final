-- 0036_departments — first-class department registry for the Employees module.
--
-- Promotes departments from free text on employees.department to a managed
-- table so HR can add / rename / remove them from a proper UI. The
-- employees.department text column stays the link (canonical lowercased name);
-- the rename action bulk-updates matching employee rows so they never drift.
--
-- Seeded from the known baseline + every distinct department already in use
-- across employees, so nothing in current data is lost.

CREATE TABLE "departments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_unique" ON "departments" USING btree ("name");
--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "departments"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Seed from departments already in use across employees.
INSERT INTO "departments" ("name")
SELECT DISTINCT lower(trim("department"))
FROM "employees"
WHERE "department" IS NOT NULL AND trim("department") <> '' AND "deleted_at" IS NULL
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
-- Seed the known baseline taxonomy.
INSERT INTO "departments" ("name") VALUES
  ('creative'), ('strategy'), ('growth'), ('operations'),
  ('finance'), ('engineering'), ('leadership')
ON CONFLICT ("name") DO NOTHING;
