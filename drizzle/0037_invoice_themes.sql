-- 0037_invoice_themes — admin-managed visual themes for generated invoice PDFs.
--
-- Two kinds:
--   'builtin' — seeded below (Modern=default, Classic, Minimal).
--   'docx'    — uploaded by an admin; the original .docx is stored as a
--               documents row and a few design tokens (theme colours, a font
--               family, the first embedded logo) are extracted at upload time.
--
-- Global scope (no per-client scoping in v1). Exactly one default at a time,
-- enforced by a partial-unique index. The selected theme is referenced from
-- invoices.theme_id (added here, nullable) and read by the PDF renderer
-- (loadInvoicePdfData) to overlay brand tokens onto the existing template.
--
-- Hand-written because db:generate (drizzle-kit) cannot serialise the
-- invoices table's bigint .default(0n) columns once invoices is in the diff;
-- this repo journals hand-written SQL migrations (single baseline snapshot).

CREATE TYPE "invoice_theme_kind" AS ENUM ('builtin', 'docx');
--> statement-breakpoint
CREATE TABLE "invoice_themes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "kind" "invoice_theme_kind" NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "source_document_id" uuid,
  "logo_document_id" uuid,
  "primary_color" text,
  "secondary_color" text,
  "accent_color" text,
  "font_family" text,
  "header_text" text,
  "footer_text" text,
  "tokens" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_themes" ADD CONSTRAINT "invoice_themes_source_document_id_documents_id_fk"
  FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_themes" ADD CONSTRAINT "invoice_themes_logo_document_id_documents_id_fk"
  FOREIGN KEY ("logo_document_id") REFERENCES "documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invoice_themes_kind_index" ON "invoice_themes" USING btree ("kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_themes_single_default" ON "invoice_themes" USING btree ("is_default")
  WHERE "is_default" AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "invoice_themes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON "invoice_themes"
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "theme_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_theme_id_invoice_themes_id_fk"
  FOREIGN KEY ("theme_id") REFERENCES "invoice_themes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Seed builtin themes. Modern is the default. Colours are hex strings; the
-- font_family must resolve to a react-pdf built-in family (Helvetica /
-- Times-Roman / Courier).
INSERT INTO "invoice_themes"
  ("name", "kind", "is_default", "primary_color", "secondary_color", "accent_color", "font_family", "header_text", "footer_text")
VALUES
  ('Modern',  'builtin', true,  '#1f6b3b', '#0f3a20', '#a4d8b3', 'Helvetica',   'TAX INVOICE', 'This is a computer-generated invoice and does not require a signature.'),
  ('Classic', 'builtin', false, '#1a3b6e', '#0c1f3d', '#9ec2f0', 'Times-Roman', 'TAX INVOICE', 'This is a computer-generated invoice and does not require a signature.'),
  ('Minimal', 'builtin', false, '#3a3a3a', '#1a1a1a', '#8a8a8a', 'Helvetica',   'INVOICE',     'Computer-generated. No signature required.');
