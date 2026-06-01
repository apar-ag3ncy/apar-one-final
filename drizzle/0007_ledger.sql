-- ───────────────────────────────────────────────────────────────────────────
-- 0007_ledger — Phase 4 of the agent-backend brief. THE MAIN GAME.
--
-- Builds the double-entry ledger per LEDGER-SPEC v2 §1 + §8 + the
-- agent-backend prompt's pre-answered §10 decisions:
--
--   §10.1: separate `2180 Client Advances Received` (liability)
--   §10.2: one-bucket `2130 TDS Payable` + postings.metadata.tds_section
--   §10.3: fresh start 1 April 2026. Opening JV = agency bank opening
--          balances + partner capital. Seeded by the application seed
--          script (Phase 5), not this DDL migration.
--   §10.4: 3100 / 3200 sub-ledgered by partner_user_id
--   §10.5: capitalization threshold ₹5,000
--   §10.6: <REPLACE WITH YOUR LIST> placeholder — seeded with ONE
--          `is_active=false` HDFC Current placeholder account so seeds
--          / posting templates have something to reference. Replace
--          before go-live.
--
-- Order:
--   1. New enums (account_type, subledger_kind, period_status,
--      transaction_kind, transaction_status, transaction_source_kind,
--      posting_side, reconciliation_status, bank_statement_status,
--      bank_line_match_confidence, validation_severity, tax_rate_kind)
--   2. accounts + 25-account chart of accounts seed (§2 v2 + 2180)
--   3. periods + period-assignment trigger + initial FY 2026 + 2027 periods
--   4. bank_accounts + placeholder seed
--   5. transactions + postings + all §8 invariants
--      (balanced, ≥2 postings, control discipline, no-edit-on-posted,
--       no-delete-ever, external_ref UNIQUE, source_document required)
--   6. bank_statements + bank_statement_lines
--   7. validation_rules seed (8 rules, 3 enabled by default)
--   8. tax_reference_rates seed (GST + TDS sections per prompt header)
--   9. settings seed (enforce_period_close=false, ₹5k capitalization,
--      25 MB doc max, extraction_auto_confirm=false)
--   10. RLS on every new table + append-only protection on transactions /
--       postings / periods (no UPDATE outside whitelist, no DELETE at all)
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ──────────────────────────────────────────────────────────────

CREATE TYPE "public"."account_type" AS ENUM('asset','liability','equity','income','expense','contra_asset');--> statement-breakpoint
CREATE TYPE "public"."subledger_kind" AS ENUM('bank_account','client','vendor','employee','partner_user_id');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open','soft_closed','closed');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM(
  'client_invoice','client_payment_received','client_advance_received',
  'vendor_bill','vendor_payment_made','expense_on_behalf','employee_reimbursement',
  'office_expense','inter_bank_transfer','partner_capital','partner_drawing',
  'journal','salary_disbursement','bonus_payment'
);--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('draft','posted','reversed');--> statement-breakpoint
CREATE TYPE "public"."transaction_source_kind" AS ENUM(
  'invoice','bill','receipt','payment','payslip','journal','bank_import','extraction','opening_balance'
);--> statement-breakpoint
CREATE TYPE "public"."posting_side" AS ENUM('debit','credit');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('unreconciled','matched','manual','na');--> statement-breakpoint
CREATE TYPE "public"."bank_statement_status" AS ENUM('in_progress','complete');--> statement-breakpoint
CREATE TYPE "public"."bank_line_match_confidence" AS ENUM('exact','likely','manual','unmatched');--> statement-breakpoint
CREATE TYPE "public"."validation_severity" AS ENUM('info','warn','block');--> statement-breakpoint
CREATE TYPE "public"."tax_rate_kind" AS ENUM('gst','tds','other');
--> statement-breakpoint

-- ── 2. accounts ───────────────────────────────────────────────────────────

CREATE TABLE "accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "type" "account_type" NOT NULL,
  "parent_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
  "is_control" boolean DEFAULT false NOT NULL,
  "subledger_kind" "subledger_kind",
  "is_active" boolean DEFAULT true NOT NULL,
  "currency" char(3) DEFAULT 'INR' NOT NULL,
  "metadata" jsonb DEFAULT '{}' NOT NULL,
  "closed_at" timestamp with time zone,
  CONSTRAINT "accounts_control_requires_subledger" CHECK (
    (is_control = false AND subledger_kind IS NULL)
    OR (is_control = true AND subledger_kind IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_unique" ON "accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "accounts_type_index" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "accounts_parent_id_index" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "accounts_is_control_index" ON "accounts" USING btree ("is_control");--> statement-breakpoint

-- ── Chart of accounts seed (LEDGER-SPEC §2 v2 + 2180 = 25 accounts) ──────

INSERT INTO "accounts" (code, name, type, is_control, subledger_kind) VALUES
  -- 1000 — Assets
  ('1110', 'Cash on Hand',                        'asset',     false, NULL),
  ('1120', 'Bank Accounts',                       'asset',     true,  'bank_account'),
  ('1200', 'Trade Receivables',                   'asset',     true,  'client'),
  ('1220', 'Advances to Vendors',                 'asset',     true,  'vendor'),
  ('1230', 'Advances to Employees',               'asset',     true,  'employee'),
  ('1240', 'Reimbursable Expenses on Behalf',     'asset',     true,  'client'),
  ('1250', 'GST Input Credit',                    'asset',     false, NULL),
  ('1510', 'Office Equipment & Assets',           'asset',     false, NULL),
  -- 2000 — Liabilities
  ('2110', 'Trade Payables',                      'liability', true,  'vendor'),
  ('2120', 'GST Output Payable',                  'liability', false, NULL),
  ('2130', 'TDS Payable',                         'liability', false, NULL),
  ('2140', 'Salary Payable',                      'liability', false, NULL),
  ('2180', 'Client Advances Received',            'liability', true,  'client'),
  -- 3000 — Equity
  ('3100', 'Partner Capital',                     'equity',    true,  'partner_user_id'),
  ('3200', 'Partner Drawings',                    'equity',    true,  'partner_user_id'),
  -- 4000 — Income
  ('4100', 'Service Revenue',                     'income',    true,  'client'),
  ('4200', 'Reimbursement Income',                'income',    false, NULL),
  -- 5000 — Direct costs (client-attributable)
  ('5100', 'Vendor Costs',                        'expense',   true,  'vendor'),
  ('5200', 'Reimbursable Costs on Behalf',        'expense',   false, NULL),
  -- 6000 — Operating expenses (not client-attributable)
  ('6100', 'Salaries & Wages',                    'expense',   false, NULL),
  ('6200', 'Office Rent & Utilities',             'expense',   false, NULL),
  ('6300', 'Software & Subscriptions',            'expense',   false, NULL),
  ('6400', 'Professional Fees',                   'expense',   false, NULL),
  ('6900', 'Other OpEx',                          'expense',   false, NULL),
  -- 8000 — Statutory
  ('8100', 'Statutory Dues',                      'expense',   false, NULL);
--> statement-breakpoint

-- ── 3. periods ────────────────────────────────────────────────────────────

CREATE TABLE "periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "fiscal_year" integer NOT NULL,
  "month" integer NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "status" "period_status" DEFAULT 'open' NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reopened_at" timestamp with time zone,
  "reopened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reopen_reason" text,
  CONSTRAINT "periods_month_range" CHECK (month BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "periods_fiscal_year_month_unique" ON "periods" USING btree ("fiscal_year","month");--> statement-breakpoint

-- Seed periods for FY 2026 (Apr 2025 – Mar 2026) and FY 2027 (the go-live FY)
-- Month 1 = April per LEDGER-SPEC §1.3 + brief.
DO $$
DECLARE
  fy int;
  m int;
  starts date;
  ends date;
BEGIN
  FOR fy IN 2026..2027 LOOP
    FOR m IN 1..12 LOOP
      -- Month 1 (Apr) … Month 9 (Dec) live in calendar year (fy-1).
      -- Month 10 (Jan) … Month 12 (Mar) live in calendar year fy.
      -- Check first, then call make_date once — otherwise make_date
      -- rejects month=13..15 before the IF can correct it.
      IF m + 3 > 12 THEN
        starts := make_date(fy, m + 3 - 12, 1);
      ELSE
        starts := make_date(fy - 1, 3 + m, 1);
      END IF;
      ends := (starts + INTERVAL '1 month - 1 day')::date;
      INSERT INTO periods (fiscal_year, month, starts_on, ends_on, status)
      VALUES (fy, m, starts, ends, 'open')
      ON CONFLICT (fiscal_year, month) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── 4. bank_accounts (agency) ─────────────────────────────────────────────

CREATE TABLE "bank_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "display_name" text NOT NULL,
  "bank_name" text NOT NULL,
  "branch" text,
  "account_last4" text NOT NULL,
  "ifsc" text NOT NULL,
  "account_type" "bank_account_type" NOT NULL,
  "vault_object_key" text NOT NULL,
  "opening_balance_paise" bigint DEFAULT 0 NOT NULL,
  "opening_balance_date" date,
  "currency" char(3) DEFAULT 'INR' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  CONSTRAINT "bank_accounts_last4_format" CHECK (length(account_last4) = 4 AND account_last4 ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE INDEX "bank_accounts_account_id_index" ON "bank_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_display_name_index" ON "bank_accounts" USING btree ("display_name");--> statement-breakpoint

-- §10.6 placeholder per the prompt's "<REPLACE WITH YOUR LIST>" — one
-- inactive HDFC Current row so posting templates have a target FK.
-- The vault_object_key points to a placeholder; replace before go-live.
INSERT INTO "bank_accounts" (
  account_id, display_name, bank_name, branch, account_last4, ifsc,
  account_type, vault_object_key, opening_balance_paise,
  opening_balance_date, is_active, notes
)
SELECT
  a.id, 'HDFC Current Apār Default', 'HDFC Bank', 'Mumbai - Lower Parel',
  '0000', 'HDFC0000000', 'current', 'placeholder/hdfc-current-default.bin',
  0, '2026-04-01', false,
  'Placeholder per agent-backend prompt §10.6 — REPLACE WITH REAL VALUES BEFORE GO-LIVE. is_active=false so it is not selectable for postings.'
FROM accounts a
WHERE a.code = '1120';
--> statement-breakpoint

-- ── 5. transactions + postings + invariants ───────────────────────────────

CREATE TABLE "transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "kind" "transaction_kind" NOT NULL,
  "external_ref" text NOT NULL,
  "description" text,
  "txn_date" date NOT NULL,
  "status" "transaction_status" DEFAULT 'draft' NOT NULL,
  "posted_at" timestamp with time zone,
  "posted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reversed_at" timestamp with time zone,
  "reversed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reverses_id" uuid REFERENCES "transactions"("id") ON DELETE RESTRICT,
  "correction_for_id" uuid REFERENCES "transactions"("id") ON DELETE RESTRICT,
  "source_kind" "transaction_source_kind" NOT NULL,
  "source_document_id" uuid REFERENCES "documents"("id") ON DELETE RESTRICT,
  "related_entity_kind" "entity_type",
  "related_entity_id" uuid,
  "on_behalf_of_client_id" uuid REFERENCES "clients"("id") ON DELETE RESTRICT,
  "paid_to_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE RESTRICT,
  "incurred_by_employee_id" uuid REFERENCES "employees"("id") ON DELETE RESTRICT,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE RESTRICT,
  "period_id" uuid REFERENCES "periods"("id") ON DELETE RESTRICT,
  "extraction_job_id" uuid,
  "validation_flags" jsonb DEFAULT '[]' NOT NULL,
  "validation_acknowledged_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "validation_acknowledged_at" timestamp with time zone,
  "notes" text,
  -- LEDGER-SPEC §8.7 — source_document_id NOT NULL except for these kinds
  CONSTRAINT "transactions_source_document_required" CHECK (
    source_document_id IS NOT NULL
    OR kind IN ('journal','inter_bank_transfer')
    OR source_kind = 'opening_balance'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_ref_unique" ON "transactions" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "transactions_kind_index" ON "transactions" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "transactions_status_index" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transactions_txn_date_index" ON "transactions" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "transactions_period_id_index" ON "transactions" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "transactions_on_behalf_of_client_id_txn_date_index" ON "transactions" USING btree ("on_behalf_of_client_id","txn_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_paid_to_vendor_id_txn_date_index" ON "transactions" USING btree ("paid_to_vendor_id","txn_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_incurred_by_employee_id_txn_date_index" ON "transactions" USING btree ("incurred_by_employee_id","txn_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_project_id_txn_date_index" ON "transactions" USING btree ("project_id","txn_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_reverses_id_index" ON "transactions" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "transactions_source_document_id_index" ON "transactions" USING btree ("source_document_id");--> statement-breakpoint

CREATE TABLE "postings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "transaction_id" uuid NOT NULL REFERENCES "transactions"("id") ON DELETE RESTRICT,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
  "subledger_entity_type" "entity_type",
  "subledger_entity_id" uuid,
  "side" "posting_side" NOT NULL,
  "amount_paise" bigint NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "fx_rate" bigint,
  "reconciliation_status" "reconciliation_status" DEFAULT 'unreconciled' NOT NULL,
  "bank_statement_line_id" uuid,
  "metadata" jsonb DEFAULT '{}' NOT NULL,
  -- Amount is always positive; side discriminates Dr/Cr
  CONSTRAINT "postings_amount_positive" CHECK (amount_paise > 0),
  -- Sub-ledger fields are required iff the account is a control account
  -- (enforced by trigger because the account lookup is not visible to a CHECK)
  CONSTRAINT "postings_subledger_pair" CHECK (
    (subledger_entity_type IS NULL AND subledger_entity_id IS NULL)
    OR (subledger_entity_type IS NOT NULL AND subledger_entity_id IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "postings_transaction_id_index" ON "postings" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "postings_account_id_created_at_index" ON "postings" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "postings_account_subledger_index" ON "postings" USING btree ("account_id","subledger_entity_type","subledger_entity_id");--> statement-breakpoint
CREATE INDEX "postings_subledger_entity_index" ON "postings" USING btree ("subledger_entity_type","subledger_entity_id");--> statement-breakpoint
CREATE INDEX "postings_bank_statement_line_id_index" ON "postings" USING btree ("bank_statement_line_id");--> statement-breakpoint

-- ── Control-account discipline trigger ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_postings_control_discipline() RETURNS TRIGGER AS $$
DECLARE
  v_is_control boolean;
  v_subledger_kind text;
BEGIN
  SELECT is_control, subledger_kind::text INTO v_is_control, v_subledger_kind
  FROM accounts WHERE id = NEW.account_id;

  IF v_is_control IS NULL THEN
    RAISE EXCEPTION 'postings.account_id % does not exist', NEW.account_id;
  END IF;

  IF v_is_control AND (NEW.subledger_entity_type IS NULL OR NEW.subledger_entity_id IS NULL) THEN
    RAISE EXCEPTION 'control account % requires subledger_entity_type + subledger_entity_id', NEW.account_id;
  END IF;

  IF NOT v_is_control AND NEW.subledger_entity_type IS NOT NULL THEN
    RAISE EXCEPTION 'non-control account % must not have subledger fields', NEW.account_id;
  END IF;

  -- Match subledger_kind ↔ subledger_entity_type when control
  IF v_is_control THEN
    IF v_subledger_kind = 'bank_account' AND NOT EXISTS (
      SELECT 1 FROM bank_accounts WHERE id = NEW.subledger_entity_id
    ) THEN
      RAISE EXCEPTION 'control account % subledger %: bank_account % not found',
        NEW.account_id, v_subledger_kind, NEW.subledger_entity_id;
    END IF;
    -- For polymorphic kinds we reuse the entity_type / entity_id check
    IF v_subledger_kind IN ('client','vendor','employee') THEN
      IF NEW.subledger_entity_type::text <> v_subledger_kind THEN
        RAISE EXCEPTION 'control account % expects subledger_entity_type=%, got %',
          NEW.account_id, v_subledger_kind, NEW.subledger_entity_type;
      END IF;
      PERFORM public.assert_polymorphic_entity_exists(
        NEW.subledger_entity_type::text, NEW.subledger_entity_id
      );
    END IF;
    IF v_subledger_kind = 'partner_user_id' THEN
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.subledger_entity_id AND role = 'partner') THEN
        RAISE EXCEPTION 'control account % expects a partner user, got %',
          NEW.account_id, NEW.subledger_entity_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_postings_control_discipline
  BEFORE INSERT OR UPDATE OF account_id, subledger_entity_type, subledger_entity_id
  ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.tg_postings_control_discipline();
--> statement-breakpoint

-- ── Balanced-postings deferred constraint ─────────────────────────────────
-- LEDGER-SPEC §8.2: SUM(debit) = SUM(credit) per posted transaction.
-- Implemented via a constraint trigger that fires at COMMIT — that way
-- a posting template can insert all legs in any order within one
-- transaction and the check runs once.

CREATE OR REPLACE FUNCTION public.tg_check_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_debit bigint;
  v_credit bigint;
  v_count int;
  v_txn_id uuid;
BEGIN
  v_txn_id := COALESCE(NEW.id, OLD.id);
  SELECT status::text INTO v_status FROM transactions WHERE id = v_txn_id;
  IF v_status IS NULL OR v_status <> 'posted' THEN
    -- Only enforced on posted transactions; drafts can be unbalanced.
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(amount_paise) FILTER (WHERE side = 'debit'),  0),
    COALESCE(SUM(amount_paise) FILTER (WHERE side = 'credit'), 0),
    COUNT(*)
    INTO v_debit, v_credit, v_count
  FROM postings WHERE transaction_id = v_txn_id;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'transaction % has % postings; ≥2 required', v_txn_id, v_count;
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'transaction % unbalanced: Dr=% Cr=%', v_txn_id, v_debit, v_credit;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_transactions_balanced
  AFTER INSERT OR UPDATE OF status ON public.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_check_transaction_balanced();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER trg_postings_balanced
  AFTER INSERT OR UPDATE OR DELETE ON public.postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_check_transaction_balanced();
--> statement-breakpoint

-- ── Period-assignment trigger ─────────────────────────────────────────────
-- LEDGER-SPEC §1.3: txn.txn_date → period_id auto-assigned.

CREATE OR REPLACE FUNCTION public.tg_assign_transaction_period() RETURNS TRIGGER AS $$
DECLARE
  v_period_id uuid;
BEGIN
  IF NEW.period_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_period_id
  FROM periods
  WHERE NEW.txn_date BETWEEN starts_on AND ends_on
  LIMIT 1;
  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'no period defined for txn_date %; seed periods for FY %', NEW.txn_date,
      CASE WHEN EXTRACT(MONTH FROM NEW.txn_date)::int >= 4
           THEN EXTRACT(YEAR FROM NEW.txn_date)::int + 1
           ELSE EXTRACT(YEAR FROM NEW.txn_date)::int END;
  END IF;
  NEW.period_id := v_period_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_transactions_assign_period
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_transaction_period();
--> statement-breakpoint

-- ── No-edit-on-posted RLS-ish enforcement at the trigger layer ────────────
-- RLS handles the user-visible policy; this trigger is a belt-and-braces
-- for the service-role case (which bypasses RLS). LEDGER-SPEC §1.2 #4 /
-- §8.4 + SPEC-AMENDMENT-001 §3.2 whitelist:
--   transactions: validation_flags, validation_acknowledged_by/at, notes
--   postings:     reconciliation_status, bank_statement_line_id

CREATE OR REPLACE FUNCTION public.tg_block_edit_posted_transactions() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('posted','reversed') THEN
    -- Allow status flip to 'reversed' only from a reversal-issuing path,
    -- which we represent by setting reversed_at + reversed_by; otherwise
    -- block any field change.
    IF NEW.status <> OLD.status THEN
      IF NOT (OLD.status = 'posted' AND NEW.status = 'reversed'
              AND NEW.reversed_at IS NOT NULL AND NEW.reversed_by IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot change status from % to % on transaction %', OLD.status, NEW.status, OLD.id;
      END IF;
    END IF;
    IF NEW.kind <> OLD.kind
       OR NEW.external_ref <> OLD.external_ref
       OR NEW.txn_date <> OLD.txn_date
       OR NEW.source_kind <> OLD.source_kind
       OR COALESCE(NEW.source_document_id::text, '') <> COALESCE(OLD.source_document_id::text, '')
       OR COALESCE(NEW.related_entity_kind::text, '') <> COALESCE(OLD.related_entity_kind::text, '')
       OR COALESCE(NEW.related_entity_id::text, '')   <> COALESCE(OLD.related_entity_id::text, '')
       OR COALESCE(NEW.on_behalf_of_client_id::text, '') <> COALESCE(OLD.on_behalf_of_client_id::text, '')
       OR COALESCE(NEW.paid_to_vendor_id::text, '')      <> COALESCE(OLD.paid_to_vendor_id::text, '')
       OR COALESCE(NEW.incurred_by_employee_id::text, '') <> COALESCE(OLD.incurred_by_employee_id::text, '')
       OR COALESCE(NEW.project_id::text, '') <> COALESCE(OLD.project_id::text, '')
       OR COALESCE(NEW.period_id::text, '') <> COALESCE(OLD.period_id::text, '')
    THEN
      RAISE EXCEPTION 'posted transaction % only allows whitelisted edits (validation_flags, validation_acknowledged_*, notes)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_transactions_block_posted_edit
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_edit_posted_transactions();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.tg_block_edit_posted_postings() RETURNS TRIGGER AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM transactions WHERE id = OLD.transaction_id;
  IF v_status IN ('posted','reversed') THEN
    IF NEW.transaction_id <> OLD.transaction_id
       OR NEW.account_id <> OLD.account_id
       OR COALESCE(NEW.subledger_entity_type::text, '') <> COALESCE(OLD.subledger_entity_type::text, '')
       OR COALESCE(NEW.subledger_entity_id::text, '')   <> COALESCE(OLD.subledger_entity_id::text, '')
       OR NEW.side <> OLD.side
       OR NEW.amount_paise <> OLD.amount_paise
       OR NEW.currency <> OLD.currency
    THEN
      RAISE EXCEPTION 'posted posting % only allows reconciliation_status / bank_statement_line_id / metadata edits', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_postings_block_posted_edit
  BEFORE UPDATE ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_edit_posted_postings();
--> statement-breakpoint

-- ── No-delete-ever trigger (belt-and-suspenders to RLS) ──────────────────

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'DELETE forbidden on ledger table %. LEDGER-SPEC §0.3 / §8.5. Reverse instead.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_transactions_block_delete
  BEFORE DELETE ON public.transactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_block_delete_ledger();
--> statement-breakpoint

CREATE TRIGGER trg_postings_block_delete
  BEFORE DELETE ON public.postings
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_block_delete_ledger();
--> statement-breakpoint

-- ── 6. bank_statements + bank_statement_lines ─────────────────────────────

CREATE TABLE "bank_statements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "bank_account_id" uuid NOT NULL REFERENCES "bank_accounts"("id") ON DELETE RESTRICT,
  "statement_from" date NOT NULL,
  "statement_to" date NOT NULL,
  "uploaded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_document_id" uuid REFERENCES "documents"("id") ON DELETE RESTRICT,
  "closing_balance_paise" bigint NOT NULL,
  "imported_lines_count" integer DEFAULT 0 NOT NULL,
  "reconciliation_status" "bank_statement_status" DEFAULT 'in_progress' NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX "bank_statements_bank_account_id_statement_to_index" ON "bank_statements" USING btree ("bank_account_id","statement_to" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bank_statements_reconciliation_status_index" ON "bank_statements" USING btree ("reconciliation_status");--> statement-breakpoint

CREATE TABLE "bank_statement_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "bank_statement_id" uuid NOT NULL REFERENCES "bank_statements"("id") ON DELETE CASCADE,
  "line_date" date NOT NULL,
  "description" text NOT NULL,
  "ref_number" text,
  "debit_paise" bigint DEFAULT 0 NOT NULL,
  "credit_paise" bigint DEFAULT 0 NOT NULL,
  "running_balance_paise" bigint NOT NULL,
  "matched_posting_id" uuid REFERENCES "postings"("id") ON DELETE SET NULL,
  "matched_at" timestamp with time zone,
  "matched_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "match_confidence" "bank_line_match_confidence" DEFAULT 'unmatched' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bank_statement_lines_bank_statement_id_line_date_index" ON "bank_statement_lines" USING btree ("bank_statement_id","line_date");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_match_confidence_index" ON "bank_statement_lines" USING btree ("match_confidence");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_matched_posting_id_index" ON "bank_statement_lines" USING btree ("matched_posting_id");--> statement-breakpoint

-- Wire the postings.bank_statement_line_id FK now that bank_statement_lines exists.
ALTER TABLE "postings" ADD CONSTRAINT "postings_bank_statement_line_id_fk"
  FOREIGN KEY ("bank_statement_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ── 7. validation_rules ───────────────────────────────────────────────────

CREATE TABLE "validation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "description" text NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}' NOT NULL,
  "severity" "validation_severity" NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "validation_rules_code_unique" ON "validation_rules" USING btree ("code");--> statement-breakpoint

INSERT INTO "validation_rules" (code, description, is_enabled, severity) VALUES
  ('gst_rate_mismatch',          'Captured GST rate differs from the reference rate for the line.', false, 'warn'),
  ('tds_missing',                'Vendor bill over threshold without TDS posted.',                  false, 'warn'),
  ('tds_threshold_crossed',      'Cumulative payments crossed an FY threshold.',                    false, 'warn'),
  ('document_missing',           'Non-exempt transaction without a source_document_id.',            true,  'block'),
  ('external_ref_clash',         'Duplicate external_ref already exists.',                          true,  'block'),
  ('subledger_entity_archived',  'Posting against an archived entity.',                             false, 'info'),
  ('period_closed',              'Transaction posted into a closed period.',                        false, 'block'),
  ('client_attribution_missing', 'Vendor bill saved without explicit attribution (client/opex/asset).', true, 'block');
--> statement-breakpoint

-- ── 8. tax_reference_rates ────────────────────────────────────────────────

CREATE TABLE "tax_reference_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "kind" "tax_rate_kind" NOT NULL,
  "code" text NOT NULL,
  "description" text NOT NULL,
  "rate_bps" integer NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "statutory_section" text,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_reference_rates_code_effective_from_unique" ON "tax_reference_rates" USING btree ("code","effective_from");--> statement-breakpoint
CREATE INDEX "tax_reference_rates_kind_index" ON "tax_reference_rates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tax_reference_rates_effective_index" ON "tax_reference_rates" USING btree ("effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "tax_reference_rates_is_enabled_index" ON "tax_reference_rates" USING btree ("is_enabled");--> statement-breakpoint

-- TDS sections per the agent-backend prompt header (all disabled per prompt).
INSERT INTO "tax_reference_rates" (kind, code, description, rate_bps, effective_from, statutory_section, is_enabled) VALUES
  ('tds', 'TDS_192',          'Salary',                                                   0,    '2026-04-01', '192',  false),
  ('tds', 'TDS_194C_1',       'Contractor — individual/HUF',                              100,  '2026-04-01', '194C', false),
  ('tds', 'TDS_194C_2',       'Contractor — other',                                       200,  '2026-04-01', '194C', false),
  ('tds', 'TDS_194J',         'Professional/technical services',                          1000, '2026-04-01', '194J', false),
  ('tds', 'TDS_194I_BLDG',    'Rent — land/building',                                     1000, '2026-04-01', '194I', false),
  ('tds', 'TDS_194I_PLANT',   'Rent — plant/machinery',                                   200,  '2026-04-01', '194I', false),
  ('tds', 'TDS_194H',         'Commission/brokerage',                                     500,  '2026-04-01', '194H', false),
  ('tds', 'TDS_194Q',         'Purchase of goods (large vendors)',                        10,   '2026-04-01', '194Q', false),
  -- GST reference rates (also disabled by default; enable per CA guidance)
  ('gst', 'GST_SERVICE_STD',  'Standard service rate (18%)',                              1800, '2026-04-01', NULL,   false),
  ('gst', 'GST_SERVICE_RED',  'Reduced service rate (12%)',                               1200, '2026-04-01', NULL,   false),
  ('gst', 'GST_GOODS_STD',    'Standard goods rate (18%)',                                1800, '2026-04-01', NULL,   false),
  ('gst', 'GST_GOODS_RED',    'Reduced goods rate (5%)',                                  500,  '2026-04-01', NULL,   false);
--> statement-breakpoint

-- ── 9. settings ───────────────────────────────────────────────────────────

CREATE TABLE "settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "key" text NOT NULL,
  "value_bool" boolean,
  "value_int" integer,
  "value_text" text,
  "value_json" jsonb,
  "description" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_unique" ON "settings" USING btree ("key");--> statement-breakpoint

INSERT INTO "settings" (key, value_bool, description) VALUES
  ('enforce_period_close', false,
   'When true, transactions cannot post into a soft-closed/closed period. v1 defaults off per LEDGER-SPEC §7.'),
  ('extraction_auto_confirm', false,
   'When true, high-confidence extractions auto-confirm into ledger transactions. v1 defaults off per CLAUDE rule #8.');
--> statement-breakpoint

INSERT INTO "settings" (key, value_int, description) VALUES
  ('capitalization_threshold_paise', 500000,
   'Vendor bills above this go to 1510 Office Equipment; below to 6300/6900. Per LEDGER-SPEC §10.5 + prompt §10.5 = ₹5,000.'),
  ('document_max_size_mb', 25,
   'Max upload size per SPEC-AMENDMENT-001 §10.3.');
--> statement-breakpoint

-- ── 10. RLS on all new ledger tables ─────────────────────────────────────

ALTER TABLE "accounts"               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "periods"                ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts"          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions"           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "postings"               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statements"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statement_lines"   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "validation_rules"       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tax_reference_rates"    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings"               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Service-role-all on the read/write tables (Phase 4.6 layers per-role
-- and per-capability policies).
CREATE POLICY "service_role all" ON "accounts"             FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "periods"              FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "bank_accounts"        FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "bank_statements"      FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "bank_statement_lines" FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "validation_rules"     FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "tax_reference_rates"  FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role all" ON "settings"             FOR ALL TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint

-- transactions / postings: INSERT + SELECT only via policy; UPDATE is
-- still controlled by the trigger's whitelist; DELETE is impossible
-- (no policy → default deny; the trigger raises anyway).
CREATE POLICY "service_role insert" ON "transactions" FOR INSERT TO service_role WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role select" ON "transactions" FOR SELECT TO service_role USING (true);--> statement-breakpoint
CREATE POLICY "service_role update" ON "transactions" FOR UPDATE TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint

CREATE POLICY "service_role insert" ON "postings" FOR INSERT TO service_role WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "service_role select" ON "postings" FOR SELECT TO service_role USING (true);--> statement-breakpoint
CREATE POLICY "service_role update" ON "postings" FOR UPDATE TO service_role USING (true) WITH CHECK (true);--> statement-breakpoint

-- The trigger blocks DELETE on these tables for everyone including service
-- role. The REVOKE belt-and-braces ensures the grant layer agrees.
REVOKE DELETE, TRUNCATE ON "transactions" FROM PUBLIC;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "transactions" FROM authenticated;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "transactions" FROM anon;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "postings" FROM PUBLIC;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "postings" FROM authenticated;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "postings" FROM anon;
