-- 0049_client_receipts — client-side money-recording on the ledger model.
--
-- (1) New account 1260 TDS Receivable (asset) — TDS that clients withhold
--     from our receipts is our claimable asset, so a receipt of net cash + a
--     TDS debit fully clears the invoice's receivable.
-- (2) receipt_allocations — symmetric to bill_allocations, but for the client
--     side: a `client_payment_received` transaction allocates against one or
--     more `client_invoice` transactions. Outstanding-per-invoice + receivables
--     reports read this. INCLUDES deleted_at (unlike 0031) so it matches the
--     timestamps() schema mixin and Drizzle INSERTs don't break.
--
-- The sum-check trigger enforces SUM(amount_paise) over a
-- client_payment_txn_id <= the payment's total (= SUM of debits on that txn).

INSERT INTO "accounts" (code, name, type, is_control, subledger_kind)
SELECT '1260', 'TDS Receivable', 'asset', false, NULL
WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE code = '1260');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  client_payment_txn_id uuid NOT NULL
    REFERENCES transactions(id) ON DELETE CASCADE,
  client_invoice_txn_id uuid NOT NULL
    REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS receipt_allocations_payment_invoice_unique
  ON receipt_allocations (client_payment_txn_id, client_invoice_txn_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipt_allocations_payment_idx
  ON receipt_allocations (client_payment_txn_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS receipt_allocations_invoice_idx
  ON receipt_allocations (client_invoice_txn_id);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_receipt_allocation_sum_check_ins()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  payment_total bigint;
  sum_alloc bigint;
BEGIN
  FOR rec IN SELECT DISTINCT client_payment_txn_id FROM new_table LOOP
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO payment_total
      FROM postings p
      WHERE p.transaction_id = rec.client_payment_txn_id
        AND p.side = 'debit';
    SELECT COALESCE(SUM(amount_paise), 0)::bigint
      INTO sum_alloc
      FROM receipt_allocations
      WHERE client_payment_txn_id = rec.client_payment_txn_id;
    IF sum_alloc > payment_total THEN
      RAISE EXCEPTION
        'receipt_allocations sum % exceeds client_payment_received total % (txn_id=%)',
        sum_alloc, payment_total, rec.client_payment_txn_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_receipt_allocation_sum_check_upd()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  payment_total bigint;
  sum_alloc bigint;
BEGIN
  FOR rec IN
    SELECT client_payment_txn_id FROM new_table
    UNION
    SELECT client_payment_txn_id FROM old_table
  LOOP
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO payment_total
      FROM postings p
      WHERE p.transaction_id = rec.client_payment_txn_id
        AND p.side = 'debit';
    SELECT COALESCE(SUM(amount_paise), 0)::bigint
      INTO sum_alloc
      FROM receipt_allocations
      WHERE client_payment_txn_id = rec.client_payment_txn_id;
    IF sum_alloc > payment_total THEN
      RAISE EXCEPTION
        'receipt_allocations sum % exceeds client_payment_received total % (txn_id=%)',
        sum_alloc, payment_total, rec.client_payment_txn_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_receipt_allocation_sum_ins ON receipt_allocations;
--> statement-breakpoint
CREATE TRIGGER tg_receipt_allocation_sum_ins
  AFTER INSERT ON receipt_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_receipt_allocation_sum_check_ins();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_receipt_allocation_sum_upd ON receipt_allocations;
--> statement-breakpoint
CREATE TRIGGER tg_receipt_allocation_sum_upd
  AFTER UPDATE ON receipt_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_receipt_allocation_sum_check_upd();
--> statement-breakpoint

ALTER TABLE receipt_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "service_role all" ON receipt_allocations;
--> statement-breakpoint
CREATE POLICY "service_role all" ON receipt_allocations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
