-- Phase 4 — bill_allocations.
--
-- Symmetric to payment_allocations (receipts → invoices) for the
-- vendor side. A `vendor_payment_made` transaction allocates against
-- one or more `vendor_bill` transactions; aging reports + per-bill
-- outstanding need to know "of this ₹X payment, how much went to
-- which bill" so they can compute payable balances properly.
--
-- Until this lands, AP aging is approximated from the running balance
-- on account 2110 sub-ledgered by vendor. Phase 6 swaps to the
-- allocation-aware query.
--
-- The sum-check trigger enforces:
--   SUM(amount_paise) over a vendor_payment_txn_id
--     <= the payment's total (= SUM of debits on that transaction).
-- The total is derived from postings instead of stored separately,
-- mirroring how `receipts.total_paise` works for the receipt side.

CREATE TABLE bill_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  vendor_payment_txn_id uuid NOT NULL
    REFERENCES transactions(id) ON DELETE CASCADE,
  bill_txn_id uuid NOT NULL
    REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_paise bigint NOT NULL CHECK (amount_paise > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX bill_allocations_payment_bill_unique
  ON bill_allocations (vendor_payment_txn_id, bill_txn_id);
--> statement-breakpoint

CREATE INDEX bill_allocations_payment_idx
  ON bill_allocations (vendor_payment_txn_id);
--> statement-breakpoint
CREATE INDEX bill_allocations_bill_idx
  ON bill_allocations (bill_txn_id);
--> statement-breakpoint

-- Sum-check trigger pattern lifted from tg_payment_allocation_sum_check_*.
-- A vendor_payment_made transaction has two postings (Dr 2110 / Cr 1120),
-- both with the same amount_paise; summing debits gives the payment total.
CREATE OR REPLACE FUNCTION tg_bill_allocation_sum_check_ins()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  payment_total bigint;
  sum_alloc bigint;
BEGIN
  FOR rec IN SELECT DISTINCT vendor_payment_txn_id FROM new_table LOOP
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO payment_total
      FROM postings p
      WHERE p.transaction_id = rec.vendor_payment_txn_id
        AND p.side = 'debit';
    SELECT COALESCE(SUM(amount_paise), 0)::bigint
      INTO sum_alloc
      FROM bill_allocations
      WHERE vendor_payment_txn_id = rec.vendor_payment_txn_id;
    IF sum_alloc > payment_total THEN
      RAISE EXCEPTION
        'bill_allocations sum % exceeds vendor_payment_made total % (txn_id=%)',
        sum_alloc, payment_total, rec.vendor_payment_txn_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_bill_allocation_sum_check_upd()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  payment_total bigint;
  sum_alloc bigint;
BEGIN
  FOR rec IN
    SELECT vendor_payment_txn_id FROM new_table
    UNION
    SELECT vendor_payment_txn_id FROM old_table
  LOOP
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO payment_total
      FROM postings p
      WHERE p.transaction_id = rec.vendor_payment_txn_id
        AND p.side = 'debit';
    SELECT COALESCE(SUM(amount_paise), 0)::bigint
      INTO sum_alloc
      FROM bill_allocations
      WHERE vendor_payment_txn_id = rec.vendor_payment_txn_id;
    IF sum_alloc > payment_total THEN
      RAISE EXCEPTION
        'bill_allocations sum % exceeds vendor_payment_made total % (txn_id=%)',
        sum_alloc, payment_total, rec.vendor_payment_txn_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER tg_bill_allocation_sum_ins
  AFTER INSERT ON bill_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_bill_allocation_sum_check_ins();
--> statement-breakpoint

CREATE TRIGGER tg_bill_allocation_sum_upd
  AFTER UPDATE ON bill_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_bill_allocation_sum_check_upd();
--> statement-breakpoint

-- RLS: mirror the payment_allocations pattern from 0019. The app runs
-- as service_role, which gets full access; non-service callers (RLS-
-- authenticated user JWTs in the future) see nothing until a more
-- granular policy ships.
ALTER TABLE bill_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "service_role all" ON bill_allocations
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
--> statement-breakpoint
