-- 0080_release_reversed_invoice_allocations — free credit stranded on reversed invoices.
--
-- Background: when a `client_invoice` transaction is reversed (voided/amended),
-- its Dr 1200 receivable is undone, but its `receipt_allocations` rows linger.
-- The read side already excludes reversed-RECEIPT allocations from an invoice's
-- outstanding (appliedFromLiveReceipts), but there was no equivalent handling for
-- reversed-INVOICE allocations on the receipt/pool side: getClientUnappliedCredit
-- counts ALL of a receipt's allocation rows as "used", so a receipt allocated to a
-- since-reversed invoice had its credit permanently consumed by a dead invoice and
-- could never be re-applied to the reissue.
--
-- The fix RELEASES those allocations by soft-deleting them (set `deleted_at`), done
-- at reversal time in reverseTransaction. `amount_paise > 0` is CHECK-enforced, so
-- zeroing the amount is impossible — deleted_at is the only "released" marker, and
-- it is the same one project-receipts.ts already filters on.
--
-- Two changes here keep the DB in agreement with the read side:
--   (1) The per-receipt sum-check trigger must ignore released rows, otherwise a
--       later re-allocation of the freed credit would sum the dead row + the new
--       row and falsely exceed the receipt total.
--   (2) A one-time backfill releases allocations already stranded on invoices that
--       are not a live posted invoice (reversed/voided), restoring their credit.

-- (1) Sum-check triggers: count only live (non-released) allocation rows.
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
      WHERE client_payment_txn_id = rec.client_payment_txn_id
        AND deleted_at IS NULL;
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
      WHERE client_payment_txn_id = rec.client_payment_txn_id
        AND deleted_at IS NULL;
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

-- (2) Backfill: release allocations pointing at an invoice txn that is not a live
-- posted invoice (reversed originals and reversal legs), so their credit returns to
-- the unapplied pool. Only touches not-yet-released rows.
UPDATE receipt_allocations ra
SET deleted_at = now()
FROM transactions inv
WHERE ra.client_invoice_txn_id = inv.id
  AND ra.deleted_at IS NULL
  AND (inv.status <> 'posted' OR inv.reverses_id IS NOT NULL);
