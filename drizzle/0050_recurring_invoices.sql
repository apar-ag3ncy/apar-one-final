-- 0050_recurring_invoices — recurring invoice / retainer schedules.
--
-- A schedule holds an invoice TEMPLATE (lines + totals + tax split, captured
-- once) plus a cadence. "Generate due" creates a draft invoice from the
-- template dated next_run_date (idempotency key recurring:<id>:<date> so a
-- re-run never duplicates), then advances next_run_date by the cadence. The
-- generated invoices are normal drafts the user reviews + sends.
CREATE TYPE recurring_cadence AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');
--> statement-breakpoint
CREATE TABLE "recurring_invoice_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  "created_by" uuid,
  "updated_by" uuid,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE restrict,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "name" text NOT NULL,
  "cadence" "recurring_cadence" NOT NULL,
  "interval_count" integer NOT NULL DEFAULT 1,
  "next_run_date" date NOT NULL,
  "end_date" date,
  "due_days" integer NOT NULL DEFAULT 0,
  "template" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_generated_at" timestamptz,
  "last_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE set null,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "recurring_invoice_schedules_client_idx" ON "recurring_invoice_schedules" ("client_id");
--> statement-breakpoint
CREATE INDEX "recurring_invoice_schedules_due_idx" ON "recurring_invoice_schedules" ("next_run_date")
  WHERE "is_active" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "recurring_invoice_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "recurring_invoice_schedules"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
