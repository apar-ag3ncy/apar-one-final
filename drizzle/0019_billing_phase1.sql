-- Billing Phase 1 — schema for the v1 billing module.
--
-- Adds: service_items, party_billing_profiles, invoices, invoice_lines,
-- estimates, estimate_lines, estimate_invoice_links, credit_notes,
-- credit_note_lines, bills, bill_lines, receipts, payment_allocations,
-- customer_advances, advance_allocations, receipt_vouchers,
-- refund_vouchers, tds_reference_sections, invoice_reminder_log,
-- billing_settings.
--
-- Captured-not-computed (CLAUDE rule #2, LEDGER-SPEC §0.7): all tax /
-- subtotal / total fields on billing documents are USER-ENTERED. The
-- validation engine raises warnings when the math doesn't reconcile;
-- it never auto-corrects. Money is bigint paise everywhere
-- (CLAUDE rule #1; enforced by `npm run db:check`).
--
-- Ledger integration: billing documents post through the existing
-- `transactions` + `postings` tables via the templates under
-- `lib/server/ledger/postings/*`. No parallel ledger. The
-- `<doc>.postedTransactionId` columns back-link each posted doc to its
-- ledger txn.
--
-- Immutability discipline: once a document leaves the `draft` state
-- (invoice → sent, credit_note → issued, bill → recorded), most columns
-- are locked. Changes flow through credit notes. Drafts may be
-- soft-deleted; non-drafts may not.
--
-- Seeds: chart-of-accounts additions, SAC service items, TDS reference
-- sections, validation rules, role-capability grants, and the billing
-- settings singleton are seeded in follow-on migrations 0020-0023.

-- ============================================================================
-- 1. Enums
-- ============================================================================

CREATE TYPE party_default_payment_method AS ENUM (
  'bank_transfer', 'upi', 'card', 'cheque', 'cash', 'razorpay'
);
--> statement-breakpoint

CREATE TYPE invoice_state AS ENUM (
  'draft', 'sent', 'partially_paid', 'paid', 'void'
);
--> statement-breakpoint

CREATE TYPE estimate_state AS ENUM (
  'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'
);
--> statement-breakpoint

CREATE TYPE estimate_link_kind AS ENUM (
  'full', 'partial_pct', 'partial_amount', 'partial_lines'
);
--> statement-breakpoint

CREATE TYPE credit_note_state AS ENUM ('draft', 'issued', 'void');
--> statement-breakpoint

CREATE TYPE bill_state AS ENUM (
  'draft', 'recorded', 'partially_paid', 'paid', 'void'
);
--> statement-breakpoint

CREATE TYPE bill_attribution AS ENUM ('client', 'opex', 'asset');
--> statement-breakpoint

CREATE TYPE receipt_method AS ENUM (
  'bank_transfer', 'upi', 'card', 'cheque', 'cash', 'razorpay'
);
--> statement-breakpoint

CREATE TYPE reminder_channel AS ENUM ('email', 'sms');
--> statement-breakpoint

CREATE TYPE reminder_status AS ENUM ('sent', 'failed', 'bounced');
--> statement-breakpoint

CREATE TYPE gateway_default AS ENUM ('razorpay', 'manual');
--> statement-breakpoint

-- ============================================================================
-- 2. service_items — pre-existing draft in schema/service_items.ts; create
--    the table here. (Catalog of billable services; SAC-coded.)
-- ============================================================================

CREATE TABLE service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  sac_code text NOT NULL,
  name text NOT NULL,
  description text,
  default_rate_paise bigint,
  default_unit text,
  default_income_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  default_gst_rate_bps integer,
  default_tds_section text,
  is_active boolean NOT NULL DEFAULT true
);
--> statement-breakpoint

CREATE UNIQUE INDEX service_items_name_unique ON service_items (name);
--> statement-breakpoint
CREATE INDEX service_items_sac_code_index ON service_items (sac_code);
--> statement-breakpoint
CREATE INDEX service_items_is_active_index ON service_items (is_active);
--> statement-breakpoint

-- ============================================================================
-- 3. party_billing_profiles — per-client / per-vendor billing defaults.
-- ============================================================================

CREATE TABLE party_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  entity_type entity_type NOT NULL,
  entity_id uuid NOT NULL,
  default_payment_terms_days integer NOT NULL DEFAULT 30,
  default_place_of_supply char(2),
  default_tds_section text,
  default_payment_method party_default_payment_method,
  default_currency char(3) NOT NULL DEFAULT 'INR',
  notes text
);
--> statement-breakpoint

CREATE UNIQUE INDEX party_billing_profiles_entity_unique
  ON party_billing_profiles (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX party_billing_profiles_entity_type_index
  ON party_billing_profiles (entity_type);
--> statement-breakpoint

-- ============================================================================
-- 4. invoices — Apār → client.
-- ============================================================================

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  document_number text NOT NULL,
  document_date date NOT NULL,
  due_date date,
  financial_year_start date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  state invoice_state NOT NULL DEFAULT 'draft',
  subtotal_paise bigint NOT NULL DEFAULT 0,
  captured_tax_total_paise bigint NOT NULL DEFAULT 0,
  captured_total_paise bigint NOT NULL DEFAULT 0,
  place_of_supply char(2),
  captured_tax_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms text,
  notes text,
  idempotency_key text NOT NULL,
  sent_at timestamptz,
  viewed_at timestamptz,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  posted_transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  razorpay_payment_link_id text,
  razorpay_payment_link_url text,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint

CREATE UNIQUE INDEX invoices_document_number_per_fy_unique
  ON invoices (financial_year_start, document_number);
--> statement-breakpoint
CREATE UNIQUE INDEX invoices_idempotency_key_unique
  ON invoices (idempotency_key);
--> statement-breakpoint
CREATE INDEX invoices_client_id_document_date_index
  ON invoices (client_id, document_date DESC);
--> statement-breakpoint
CREATE INDEX invoices_project_id_index ON invoices (project_id);
--> statement-breakpoint
CREATE INDEX invoices_state_index ON invoices (state);
--> statement-breakpoint
CREATE INDEX invoices_due_date_index ON invoices (due_date);
--> statement-breakpoint
CREATE INDEX invoices_sent_at_index ON invoices (sent_at);
--> statement-breakpoint
CREATE INDEX invoices_razorpay_payment_link_id_index
  ON invoices (razorpay_payment_link_id);
--> statement-breakpoint

-- ============================================================================
-- 5. invoice_lines
-- ============================================================================

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  service_item_id uuid REFERENCES service_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  sac_code text,
  qty integer NOT NULL DEFAULT 1,
  rate_paise bigint NOT NULL DEFAULT 0,
  captured_taxable_value_paise bigint NOT NULL DEFAULT 0,
  captured_tax_rate_bps integer NOT NULL DEFAULT 0,
  captured_tax_amount_paise bigint NOT NULL DEFAULT 0,
  posting_account_code text NOT NULL DEFAULT '4100'
);
--> statement-breakpoint

CREATE UNIQUE INDEX invoice_lines_invoice_line_no_unique
  ON invoice_lines (invoice_id, line_no);
--> statement-breakpoint
CREATE INDEX invoice_lines_invoice_id_index ON invoice_lines (invoice_id);
--> statement-breakpoint
CREATE INDEX invoice_lines_service_item_id_index ON invoice_lines (service_item_id);
--> statement-breakpoint

-- ============================================================================
-- 6. estimates + estimate_lines + estimate_invoice_links
-- ============================================================================

CREATE TABLE estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  document_number text NOT NULL,
  document_date date NOT NULL,
  valid_till_date date,
  financial_year_start date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  state estimate_state NOT NULL DEFAULT 'draft',
  subtotal_paise bigint NOT NULL DEFAULT 0,
  captured_tax_total_paise bigint NOT NULL DEFAULT 0,
  captured_total_paise bigint NOT NULL DEFAULT 0,
  place_of_supply char(2),
  captured_tax_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms text,
  notes text,
  idempotency_key text NOT NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  acceptance_doc_id uuid REFERENCES entity_documents(id) ON DELETE SET NULL,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint

CREATE UNIQUE INDEX estimates_document_number_per_fy_unique
  ON estimates (financial_year_start, document_number);
--> statement-breakpoint
CREATE UNIQUE INDEX estimates_idempotency_key_unique
  ON estimates (idempotency_key);
--> statement-breakpoint
CREATE INDEX estimates_client_id_document_date_index
  ON estimates (client_id, document_date DESC);
--> statement-breakpoint
CREATE INDEX estimates_project_id_index ON estimates (project_id);
--> statement-breakpoint
CREATE INDEX estimates_state_index ON estimates (state);
--> statement-breakpoint
CREATE INDEX estimates_valid_till_date_index ON estimates (valid_till_date);
--> statement-breakpoint

CREATE TABLE estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  service_item_id uuid REFERENCES service_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  sac_code text,
  qty integer NOT NULL DEFAULT 1,
  rate_paise bigint NOT NULL DEFAULT 0,
  captured_taxable_value_paise bigint NOT NULL DEFAULT 0,
  captured_tax_rate_bps integer NOT NULL DEFAULT 0,
  captured_tax_amount_paise bigint NOT NULL DEFAULT 0,
  posting_account_code text NOT NULL DEFAULT '4100'
);
--> statement-breakpoint

CREATE UNIQUE INDEX estimate_lines_estimate_line_no_unique
  ON estimate_lines (estimate_id, line_no);
--> statement-breakpoint
CREATE INDEX estimate_lines_estimate_id_index ON estimate_lines (estimate_id);
--> statement-breakpoint
CREATE INDEX estimate_lines_service_item_id_index ON estimate_lines (service_item_id);
--> statement-breakpoint

CREATE TABLE estimate_invoice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  kind estimate_link_kind NOT NULL,
  value_pct_bps integer,
  value_paise bigint
);
--> statement-breakpoint

CREATE UNIQUE INDEX estimate_invoice_links_pair_unique
  ON estimate_invoice_links (estimate_id, invoice_id);
--> statement-breakpoint
CREATE INDEX estimate_invoice_links_estimate_id_index
  ON estimate_invoice_links (estimate_id);
--> statement-breakpoint
CREATE INDEX estimate_invoice_links_invoice_id_index
  ON estimate_invoice_links (invoice_id);
--> statement-breakpoint

-- ============================================================================
-- 7. credit_notes + credit_note_lines
-- ============================================================================

CREATE TABLE credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  document_number text NOT NULL,
  document_date date NOT NULL,
  financial_year_start date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  original_invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  state credit_note_state NOT NULL DEFAULT 'draft',
  reason text NOT NULL,
  subtotal_paise bigint NOT NULL DEFAULT 0,
  captured_tax_total_paise bigint NOT NULL DEFAULT 0,
  captured_total_paise bigint NOT NULL DEFAULT 0,
  place_of_supply char(2),
  captured_tax_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  gst_impact_allowed boolean NOT NULL DEFAULT true,
  notes text,
  idempotency_key text NOT NULL,
  issued_at timestamptz,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  posted_transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint

CREATE UNIQUE INDEX credit_notes_document_number_per_fy_unique
  ON credit_notes (financial_year_start, document_number);
--> statement-breakpoint
CREATE UNIQUE INDEX credit_notes_idempotency_key_unique
  ON credit_notes (idempotency_key);
--> statement-breakpoint
CREATE INDEX credit_notes_original_invoice_id_index
  ON credit_notes (original_invoice_id);
--> statement-breakpoint
CREATE INDEX credit_notes_client_id_document_date_index
  ON credit_notes (client_id, document_date DESC);
--> statement-breakpoint
CREATE INDEX credit_notes_state_index ON credit_notes (state);
--> statement-breakpoint

CREATE TABLE credit_note_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  credit_note_id uuid NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  original_invoice_line_id uuid REFERENCES invoice_lines(id) ON DELETE SET NULL,
  service_item_id uuid REFERENCES service_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  sac_code text,
  qty integer NOT NULL DEFAULT 1,
  rate_paise bigint NOT NULL DEFAULT 0,
  captured_taxable_value_paise bigint NOT NULL DEFAULT 0,
  captured_tax_rate_bps integer NOT NULL DEFAULT 0,
  captured_tax_amount_paise bigint NOT NULL DEFAULT 0,
  posting_account_code text NOT NULL DEFAULT '4100'
);
--> statement-breakpoint

CREATE UNIQUE INDEX credit_note_lines_cn_line_no_unique
  ON credit_note_lines (credit_note_id, line_no);
--> statement-breakpoint
CREATE INDEX credit_note_lines_credit_note_id_index
  ON credit_note_lines (credit_note_id);
--> statement-breakpoint
CREATE INDEX credit_note_lines_original_invoice_line_id_index
  ON credit_note_lines (original_invoice_line_id);
--> statement-breakpoint

-- ============================================================================
-- 8. bills + bill_lines (vendor bill headers; existing vendor_bill posting
--    template handles the ledger side).
-- ============================================================================

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  document_number text NOT NULL,
  document_date date NOT NULL,
  due_date date,
  financial_year_start date NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  attribution bill_attribution NOT NULL,
  on_behalf_of_client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES projects(id) ON DELETE RESTRICT,
  opex_account_code text,
  state bill_state NOT NULL DEFAULT 'draft',
  subtotal_paise bigint NOT NULL DEFAULT 0,
  captured_tax_total_paise bigint NOT NULL DEFAULT 0,
  captured_total_paise bigint NOT NULL DEFAULT 0,
  place_of_supply char(2),
  captured_tax_split jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_tds_amount_paise bigint NOT NULL DEFAULT 0,
  captured_tds_section text,
  captured_tds_rate_bps integer NOT NULL DEFAULT 0,
  is_rcm boolean NOT NULL DEFAULT false,
  notes text,
  idempotency_key text NOT NULL,
  recorded_at timestamptz,
  source_document_id uuid REFERENCES documents(id) ON DELETE RESTRICT,
  posted_transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT bills_attribution_dependents CHECK (
    (attribution = 'client'  AND on_behalf_of_client_id IS NOT NULL AND opex_account_code IS NULL)
 OR (attribution = 'opex'    AND on_behalf_of_client_id IS NULL     AND opex_account_code IS NOT NULL)
 OR (attribution = 'asset'   AND on_behalf_of_client_id IS NULL     AND opex_account_code IS NULL)
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX bills_vendor_document_number_unique
  ON bills (vendor_id, document_number);
--> statement-breakpoint
CREATE UNIQUE INDEX bills_idempotency_key_unique
  ON bills (idempotency_key);
--> statement-breakpoint
CREATE INDEX bills_vendor_id_document_date_index
  ON bills (vendor_id, document_date DESC);
--> statement-breakpoint
CREATE INDEX bills_on_behalf_of_client_id_document_date_index
  ON bills (on_behalf_of_client_id, document_date DESC);
--> statement-breakpoint
CREATE INDEX bills_project_id_index ON bills (project_id);
--> statement-breakpoint
CREATE INDEX bills_state_index ON bills (state);
--> statement-breakpoint
CREATE INDEX bills_attribution_index ON bills (attribution);
--> statement-breakpoint
CREATE INDEX bills_due_date_index ON bills (due_date);
--> statement-breakpoint

CREATE TABLE bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  description text NOT NULL,
  sac_code text,
  qty integer NOT NULL DEFAULT 1,
  rate_paise bigint NOT NULL DEFAULT 0,
  captured_taxable_value_paise bigint NOT NULL DEFAULT 0,
  captured_tax_rate_bps integer NOT NULL DEFAULT 0,
  captured_tax_amount_paise bigint NOT NULL DEFAULT 0,
  posting_account_code text NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX bill_lines_bill_line_no_unique ON bill_lines (bill_id, line_no);
--> statement-breakpoint
CREATE INDEX bill_lines_bill_id_index ON bill_lines (bill_id);
--> statement-breakpoint

-- ============================================================================
-- 9. receipts + payment_allocations
-- ============================================================================

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  receipt_number text NOT NULL,
  receipt_date date NOT NULL,
  financial_year_start date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  total_paise bigint NOT NULL,
  method receipt_method NOT NULL,
  gateway_payment_id text,
  gateway_fee_paise bigint NOT NULL DEFAULT 0,
  razorpay_payment_link_id text,
  razorpay_event_id text,
  captured_tds_amount_paise bigint NOT NULL DEFAULT 0,
  captured_tds_section text,
  captured_tds_rate_bps integer NOT NULL DEFAULT 0,
  notes text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  posted_transaction_id uuid REFERENCES transactions(id) ON DELETE RESTRICT,
  validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT receipts_total_positive CHECK (total_paise > 0),
  CONSTRAINT receipts_gateway_fee_nonneg CHECK (gateway_fee_paise >= 0),
  CONSTRAINT receipts_captured_tds_nonneg CHECK (captured_tds_amount_paise >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX receipts_receipt_number_per_fy_unique
  ON receipts (financial_year_start, receipt_number);
--> statement-breakpoint
CREATE UNIQUE INDEX receipts_razorpay_event_id_unique
  ON receipts (razorpay_event_id) WHERE razorpay_event_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX receipts_gateway_payment_id_unique
  ON receipts (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX receipts_client_id_receipt_date_index
  ON receipts (client_id, receipt_date DESC);
--> statement-breakpoint
CREATE INDEX receipts_bank_account_id_index ON receipts (bank_account_id);
--> statement-breakpoint
CREATE INDEX receipts_method_index ON receipts (method);
--> statement-breakpoint
CREATE INDEX receipts_razorpay_payment_link_id_index
  ON receipts (razorpay_payment_link_id);
--> statement-breakpoint

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  receipt_id uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocated_paise bigint NOT NULL,
  CONSTRAINT payment_allocations_allocated_positive CHECK (allocated_paise > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX payment_allocations_receipt_invoice_unique
  ON payment_allocations (receipt_id, invoice_id);
--> statement-breakpoint
CREATE INDEX payment_allocations_receipt_id_index
  ON payment_allocations (receipt_id);
--> statement-breakpoint
CREATE INDEX payment_allocations_invoice_id_index
  ON payment_allocations (invoice_id);
--> statement-breakpoint

-- ============================================================================
-- 10. receipt_vouchers (Rule 50) + customer_advances + advance_allocations
--     + refund_vouchers (Rule 51).
--
-- customer_advances.receipt_voucher_id and receipt_vouchers reference
-- each other 1:1, so the FK on customer_advances is added after both
-- tables exist (no circular CREATE).
-- ============================================================================

CREATE TABLE receipt_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL,
  financial_year_start date NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  advance_paise bigint NOT NULL,
  tax_paise bigint NOT NULL DEFAULT 0,
  tax_rate_bps integer NOT NULL DEFAULT 1800,
  place_of_supply char(2),
  sac_code text,
  notes text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT receipt_vouchers_advance_positive CHECK (advance_paise > 0),
  CONSTRAINT receipt_vouchers_tax_nonneg CHECK (tax_paise >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX receipt_vouchers_voucher_number_per_fy_unique
  ON receipt_vouchers (financial_year_start, voucher_number);
--> statement-breakpoint
CREATE INDEX receipt_vouchers_client_id_voucher_date_index
  ON receipt_vouchers (client_id, voucher_date DESC);
--> statement-breakpoint

CREATE TABLE customer_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  original_receipt_id uuid NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
  receipt_voucher_id uuid NOT NULL REFERENCES receipt_vouchers(id) ON DELETE RESTRICT,
  advance_paise bigint NOT NULL,
  advance_tax_paise bigint NOT NULL DEFAULT 0,
  advance_tax_rate_bps integer NOT NULL DEFAULT 1800,
  balance_paise bigint NOT NULL,
  notes text,
  CONSTRAINT customer_advances_advance_positive CHECK (advance_paise > 0),
  CONSTRAINT customer_advances_balance_nonneg CHECK (balance_paise >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX customer_advances_receipt_voucher_unique
  ON customer_advances (receipt_voucher_id);
--> statement-breakpoint
CREATE INDEX customer_advances_client_id_index
  ON customer_advances (client_id);
--> statement-breakpoint
CREATE INDEX customer_advances_original_receipt_id_index
  ON customer_advances (original_receipt_id);
--> statement-breakpoint
CREATE INDEX customer_advances_balance_paise_index
  ON customer_advances (balance_paise);
--> statement-breakpoint

CREATE TABLE advance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  advance_id uuid NOT NULL REFERENCES customer_advances(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocated_paise bigint NOT NULL,
  CONSTRAINT advance_allocations_allocated_positive CHECK (allocated_paise > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX advance_allocations_advance_invoice_unique
  ON advance_allocations (advance_id, invoice_id);
--> statement-breakpoint
CREATE INDEX advance_allocations_advance_id_index
  ON advance_allocations (advance_id);
--> statement-breakpoint
CREATE INDEX advance_allocations_invoice_id_index
  ON advance_allocations (invoice_id);
--> statement-breakpoint

CREATE TABLE refund_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  voucher_number text NOT NULL,
  voucher_date date NOT NULL,
  financial_year_start date NOT NULL,
  original_receipt_voucher_id uuid NOT NULL REFERENCES receipt_vouchers(id) ON DELETE RESTRICT,
  refund_paise bigint NOT NULL,
  tax_refund_paise bigint NOT NULL DEFAULT 0,
  reason text NOT NULL,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT refund_vouchers_refund_positive CHECK (refund_paise > 0),
  CONSTRAINT refund_vouchers_tax_nonneg CHECK (tax_refund_paise >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX refund_vouchers_voucher_number_per_fy_unique
  ON refund_vouchers (financial_year_start, voucher_number);
--> statement-breakpoint
CREATE INDEX refund_vouchers_original_receipt_voucher_id_index
  ON refund_vouchers (original_receipt_voucher_id);
--> statement-breakpoint

-- ============================================================================
-- 11. tds_reference_sections (reference data; warnings only)
-- ============================================================================

CREATE TABLE tds_reference_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  section_code text NOT NULL,
  description text NOT NULL,
  default_rate_bps_individual integer,
  default_rate_bps_company integer,
  threshold_single_paise bigint,
  threshold_fy_paise bigint,
  effective_from_date date NOT NULL,
  effective_to_date date,
  payer_type_modifier_notes text
);
--> statement-breakpoint

CREATE UNIQUE INDEX tds_reference_sections_code_effective_from_unique
  ON tds_reference_sections (section_code, effective_from_date);
--> statement-breakpoint
CREATE INDEX tds_reference_sections_effective_window_index
  ON tds_reference_sections (effective_from_date, effective_to_date);
--> statement-breakpoint
CREATE INDEX tds_reference_sections_section_code_index
  ON tds_reference_sections (section_code);
--> statement-breakpoint

-- ============================================================================
-- 12. invoice_reminder_log
-- ============================================================================

CREATE TABLE invoice_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  sent_at timestamptz NOT NULL,
  channel reminder_channel NOT NULL,
  template_used text NOT NULL,
  recipient text NOT NULL,
  status reminder_status NOT NULL,
  error_message text
);
--> statement-breakpoint

CREATE INDEX invoice_reminder_log_invoice_id_sent_at_index
  ON invoice_reminder_log (invoice_id, sent_at DESC);
--> statement-breakpoint
CREATE INDEX invoice_reminder_log_sent_at_index
  ON invoice_reminder_log (sent_at DESC);
--> statement-breakpoint
CREATE INDEX invoice_reminder_log_status_index
  ON invoice_reminder_log (status);
--> statement-breakpoint

-- ============================================================================
-- 13. billing_settings (singleton)
-- ============================================================================

CREATE TABLE billing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  singleton boolean NOT NULL DEFAULT true,
  company_default_place_of_supply char(2) NOT NULL DEFAULT '27',
  invoice_number_prefix text NOT NULL DEFAULT 'INV',
  invoice_number_format text NOT NULL DEFAULT '{prefix}/{fy}/{seq:04}',
  credit_note_number_prefix text NOT NULL DEFAULT 'CN',
  estimate_number_prefix text NOT NULL DEFAULT 'EST',
  receipt_number_prefix text NOT NULL DEFAULT 'RCT',
  receipt_voucher_number_prefix text NOT NULL DEFAULT 'RV',
  refund_voucher_number_prefix text NOT NULL DEFAULT 'REF',
  fy_start_month integer NOT NULL DEFAULT 4,
  default_payment_terms_days integer NOT NULL DEFAULT 30,
  gateway_default gateway_default NOT NULL DEFAULT 'manual',
  e_invoicing_enabled boolean NOT NULL DEFAULT false,
  -- Singleton: exactly one row with singleton = true.
  CONSTRAINT billing_settings_singleton_must_be_true CHECK (singleton = true),
  CONSTRAINT billing_settings_fy_month_valid CHECK (fy_start_month BETWEEN 1 AND 12)
);
--> statement-breakpoint

CREATE UNIQUE INDEX billing_settings_singleton_unique
  ON billing_settings (singleton);
--> statement-breakpoint

-- Seed the singleton row (idempotent — re-running the migration is a
-- no-op thanks to the unique index).
INSERT INTO billing_settings (singleton) VALUES (true)
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ============================================================================
-- 14. Triggers — allocation sum guards
--
-- Run on INSERT / UPDATE of an allocation row, compare cumulative
-- allocations against the parent's total. Statement-level to fire once
-- per DML even on multi-row writes.
-- ============================================================================

-- Separate INSERT vs UPDATE triggers — INSERT has no OLD transition
-- table, UPDATE has both. Same business rule (sum ≤ receipt total).
CREATE OR REPLACE FUNCTION tg_payment_allocation_sum_check_ins()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT DISTINCT receipt_id FROM new_table LOOP
    PERFORM 1
    FROM receipts r
    JOIN (
      SELECT COALESCE(SUM(allocated_paise), 0)::bigint AS sum_alloc
      FROM payment_allocations
      WHERE receipt_id = rec.receipt_id
    ) s ON true
    WHERE r.id = rec.receipt_id
      AND s.sum_alloc > r.total_paise;
    IF FOUND THEN
      RAISE EXCEPTION
        'payment_allocations sum exceeds receipt total (receipt_id=%)', rec.receipt_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_payment_allocation_sum_check_upd()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT receipt_id FROM new_table
    UNION
    SELECT receipt_id FROM old_table
  LOOP
    PERFORM 1
    FROM receipts r
    JOIN (
      SELECT COALESCE(SUM(allocated_paise), 0)::bigint AS sum_alloc
      FROM payment_allocations
      WHERE receipt_id = rec.receipt_id
    ) s ON true
    WHERE r.id = rec.receipt_id
      AND s.sum_alloc > r.total_paise;
    IF FOUND THEN
      RAISE EXCEPTION
        'payment_allocations sum exceeds receipt total (receipt_id=%)', rec.receipt_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_payment_allocation_sum_ins
  AFTER INSERT ON payment_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_payment_allocation_sum_check_ins();
--> statement-breakpoint

CREATE TRIGGER tg_payment_allocation_sum_upd
  AFTER UPDATE ON payment_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_payment_allocation_sum_check_upd();
--> statement-breakpoint

-- Advance allocation sum check (analogous).
CREATE OR REPLACE FUNCTION tg_advance_allocation_sum_check_ins()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT DISTINCT advance_id FROM new_table LOOP
    PERFORM 1
    FROM customer_advances a
    JOIN (
      SELECT COALESCE(SUM(allocated_paise), 0)::bigint AS sum_alloc
      FROM advance_allocations
      WHERE advance_id = rec.advance_id
    ) s ON true
    WHERE a.id = rec.advance_id
      AND s.sum_alloc > a.advance_paise;
    IF FOUND THEN
      RAISE EXCEPTION
        'advance_allocations sum exceeds advance (advance_id=%)', rec.advance_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_advance_allocation_sum_check_upd()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT advance_id FROM new_table
    UNION
    SELECT advance_id FROM old_table
  LOOP
    PERFORM 1
    FROM customer_advances a
    JOIN (
      SELECT COALESCE(SUM(allocated_paise), 0)::bigint AS sum_alloc
      FROM advance_allocations
      WHERE advance_id = rec.advance_id
    ) s ON true
    WHERE a.id = rec.advance_id
      AND s.sum_alloc > a.advance_paise;
    IF FOUND THEN
      RAISE EXCEPTION
        'advance_allocations sum exceeds advance (advance_id=%)', rec.advance_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_advance_allocation_sum_ins
  AFTER INSERT ON advance_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_advance_allocation_sum_check_ins();
--> statement-breakpoint

CREATE TRIGGER tg_advance_allocation_sum_upd
  AFTER UPDATE ON advance_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_advance_allocation_sum_check_upd();
--> statement-breakpoint

-- Keep customer_advances.balance_paise in sync after every advance_allocations
-- write. Cheap because allocations per advance are tiny (typically 1-3 rows).
CREATE OR REPLACE FUNCTION tg_advance_balance_refresh()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT advance_id FROM new_table
    UNION
    SELECT DISTINCT advance_id FROM old_table
  LOOP
    UPDATE customer_advances
    SET balance_paise = advance_paise - COALESCE((
      SELECT SUM(allocated_paise) FROM advance_allocations WHERE advance_id = rec.advance_id
    ), 0)
    WHERE id = rec.advance_id;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_advance_balance_refresh_ins
  AFTER INSERT ON advance_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_advance_balance_refresh();
--> statement-breakpoint

CREATE TRIGGER tg_advance_balance_refresh_upd
  AFTER UPDATE ON advance_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_advance_balance_refresh();
--> statement-breakpoint

-- DELETE has only OLD transition table, so split into its own function.
CREATE OR REPLACE FUNCTION tg_advance_balance_refresh_del()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT DISTINCT advance_id FROM old_table LOOP
    UPDATE customer_advances
    SET balance_paise = advance_paise - COALESCE((
      SELECT SUM(allocated_paise) FROM advance_allocations WHERE advance_id = rec.advance_id
    ), 0)
    WHERE id = rec.advance_id;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_advance_balance_refresh_del
  AFTER DELETE ON advance_allocations
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_advance_balance_refresh_del();
--> statement-breakpoint

-- ============================================================================
-- 15. Triggers — posted-document immutability
--
-- Once a billing document leaves the draft state, only a small whitelist
-- of columns is editable. Mirrors LEDGER-SPEC §8.4 for invoices /
-- credit_notes / bills. DELETE is allowed only when state = 'draft'.
-- ============================================================================

-- Invoices: editable post-draft = state, sent_at, viewed_at, notes,
-- validation_flags, posted_transaction_id, razorpay_payment_link_id,
-- razorpay_payment_link_url, updated_at, deleted_at (state-flip to void).
CREATE OR REPLACE FUNCTION tg_block_edit_sent_invoices()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW; -- drafts freely editable
  END IF;

  -- Compare non-whitelisted columns; raise if any changed.
  IF NEW.document_number IS DISTINCT FROM OLD.document_number
  OR NEW.document_date IS DISTINCT FROM OLD.document_date
  OR NEW.due_date IS DISTINCT FROM OLD.due_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.client_id IS DISTINCT FROM OLD.client_id
  OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
  OR NEW.captured_tax_total_paise IS DISTINCT FROM OLD.captured_tax_total_paise
  OR NEW.captured_total_paise IS DISTINCT FROM OLD.captured_total_paise
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.captured_tax_split IS DISTINCT FROM OLD.captured_tax_split
  OR NEW.terms IS DISTINCT FROM OLD.terms
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
  THEN
    RAISE EXCEPTION
      'invoice % is %; only whitelisted columns may be updated', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation',
            HINT = 'Edit a draft, or issue a credit note. LEDGER-SPEC §8.4.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_edit_sent_invoices
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION tg_block_edit_sent_invoices();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_delete_non_draft_invoices()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    RAISE EXCEPTION
      'cannot delete invoice % in state %; void it instead', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_delete_non_draft_invoices
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION tg_block_delete_non_draft_invoices();
--> statement-breakpoint

-- Credit notes: same shape. Whitelist post-draft = state, notes,
-- validation_flags, issued_at, posted_transaction_id, source_document_id,
-- gst_impact_allowed (recomputable), updated_at, deleted_at.
CREATE OR REPLACE FUNCTION tg_block_edit_issued_credit_notes()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.document_number IS DISTINCT FROM OLD.document_number
  OR NEW.document_date IS DISTINCT FROM OLD.document_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.client_id IS DISTINCT FROM OLD.client_id
  OR NEW.original_invoice_id IS DISTINCT FROM OLD.original_invoice_id
  OR NEW.reason IS DISTINCT FROM OLD.reason
  OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
  OR NEW.captured_tax_total_paise IS DISTINCT FROM OLD.captured_tax_total_paise
  OR NEW.captured_total_paise IS DISTINCT FROM OLD.captured_total_paise
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.captured_tax_split IS DISTINCT FROM OLD.captured_tax_split
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION
      'credit_note % is %; only whitelisted columns may be updated', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_edit_issued_credit_notes
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION tg_block_edit_issued_credit_notes();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_delete_non_draft_credit_notes()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    RAISE EXCEPTION
      'cannot delete credit_note % in state %; void it instead', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_delete_non_draft_credit_notes
  BEFORE DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION tg_block_delete_non_draft_credit_notes();
--> statement-breakpoint

-- Bills: whitelist post-draft = state, notes, validation_flags, recorded_at,
-- posted_transaction_id, updated_at, deleted_at.
CREATE OR REPLACE FUNCTION tg_block_edit_recorded_bills()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.document_number IS DISTINCT FROM OLD.document_number
  OR NEW.document_date IS DISTINCT FROM OLD.document_date
  OR NEW.due_date IS DISTINCT FROM OLD.due_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
  OR NEW.attribution IS DISTINCT FROM OLD.attribution
  OR NEW.on_behalf_of_client_id IS DISTINCT FROM OLD.on_behalf_of_client_id
  OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.opex_account_code IS DISTINCT FROM OLD.opex_account_code
  OR NEW.subtotal_paise IS DISTINCT FROM OLD.subtotal_paise
  OR NEW.captured_tax_total_paise IS DISTINCT FROM OLD.captured_tax_total_paise
  OR NEW.captured_total_paise IS DISTINCT FROM OLD.captured_total_paise
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.captured_tax_split IS DISTINCT FROM OLD.captured_tax_split
  OR NEW.captured_tds_amount_paise IS DISTINCT FROM OLD.captured_tds_amount_paise
  OR NEW.captured_tds_section IS DISTINCT FROM OLD.captured_tds_section
  OR NEW.captured_tds_rate_bps IS DISTINCT FROM OLD.captured_tds_rate_bps
  OR NEW.is_rcm IS DISTINCT FROM OLD.is_rcm
  OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
  THEN
    RAISE EXCEPTION
      'bill % is %; only whitelisted columns may be updated', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_edit_recorded_bills
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION tg_block_edit_recorded_bills();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_delete_non_draft_bills()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'draft' THEN
    RAISE EXCEPTION
      'cannot delete bill % in state %; void it instead', OLD.id, OLD.state
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_delete_non_draft_bills
  BEFORE DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION tg_block_delete_non_draft_bills();
--> statement-breakpoint

-- Statutory documents (Rule 50 receipt voucher, Rule 51 refund voucher):
-- once created they are immutable + non-deletable. Captures stay forever
-- for GST audit purposes.
CREATE OR REPLACE FUNCTION tg_block_edit_receipt_vouchers()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.voucher_number IS DISTINCT FROM OLD.voucher_number
  OR NEW.voucher_date IS DISTINCT FROM OLD.voucher_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.client_id IS DISTINCT FROM OLD.client_id
  OR NEW.advance_paise IS DISTINCT FROM OLD.advance_paise
  OR NEW.tax_paise IS DISTINCT FROM OLD.tax_paise
  OR NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps
  OR NEW.place_of_supply IS DISTINCT FROM OLD.place_of_supply
  OR NEW.sac_code IS DISTINCT FROM OLD.sac_code
  THEN
    RAISE EXCEPTION 'receipt_voucher % is immutable (Rule 50)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_edit_receipt_vouchers
  BEFORE UPDATE ON receipt_vouchers
  FOR EACH ROW EXECUTE FUNCTION tg_block_edit_receipt_vouchers();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_delete_receipt_vouchers()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'receipt_voucher % cannot be deleted (Rule 50; issue a refund voucher instead)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_delete_receipt_vouchers
  BEFORE DELETE ON receipt_vouchers
  FOR EACH ROW EXECUTE FUNCTION tg_block_delete_receipt_vouchers();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_edit_refund_vouchers()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.voucher_number IS DISTINCT FROM OLD.voucher_number
  OR NEW.voucher_date IS DISTINCT FROM OLD.voucher_date
  OR NEW.financial_year_start IS DISTINCT FROM OLD.financial_year_start
  OR NEW.original_receipt_voucher_id IS DISTINCT FROM OLD.original_receipt_voucher_id
  OR NEW.refund_paise IS DISTINCT FROM OLD.refund_paise
  OR NEW.tax_refund_paise IS DISTINCT FROM OLD.tax_refund_paise
  OR NEW.reason IS DISTINCT FROM OLD.reason
  THEN
    RAISE EXCEPTION 'refund_voucher % is immutable (Rule 51)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_edit_refund_vouchers
  BEFORE UPDATE ON refund_vouchers
  FOR EACH ROW EXECUTE FUNCTION tg_block_edit_refund_vouchers();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_block_delete_refund_vouchers()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'refund_voucher % cannot be deleted (Rule 51)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_block_delete_refund_vouchers
  BEFORE DELETE ON refund_vouchers
  FOR EACH ROW EXECUTE FUNCTION tg_block_delete_refund_vouchers();
--> statement-breakpoint

-- ============================================================================
-- 16. RLS — service-role baseline. Per-role policies layered in 0023
--     alongside the role_capabilities seeds. The dashboard reads via
--     `service_role` from server actions; client-side queries are not
--     supported on billing tables.
-- ============================================================================

ALTER TABLE service_items                ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE party_billing_profiles       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoices                     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_lines                ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE estimates                    ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE estimate_lines               ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE estimate_invoice_links       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_notes                 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_note_lines            ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bills                        ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bill_lines                   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipts                     ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_allocations          ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer_advances            ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE advance_allocations          ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipt_vouchers             ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE refund_vouchers              ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tds_reference_sections       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_reminder_log         ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing_settings             ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "service_role all" ON service_items
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON party_billing_profiles
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON invoices
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON invoice_lines
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON estimates
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON estimate_lines
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON estimate_invoice_links
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON credit_notes
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON credit_note_lines
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON bills
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON bill_lines
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON receipts
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON payment_allocations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON customer_advances
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON advance_allocations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON receipt_vouchers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON refund_vouchers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON tds_reference_sections
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON invoice_reminder_log
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "service_role all" ON billing_settings
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
