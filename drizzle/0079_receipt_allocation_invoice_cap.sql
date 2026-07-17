-- 0079_receipt_allocation_invoice_cap — per-INVOICE cap on receipt_allocations.
--
-- 0049 gave receipt_allocations an AFTER-STATEMENT sum-check per
-- client_payment_txn_id (Σ allocations <= the receipt's debit total), but there
-- was NO symmetric per-INVOICE cap: nothing stopped Σ(allocations against one
-- client_invoice txn) from exceeding that invoice's 1200 Trade Receivables debit.
-- Concurrent / interleaved writers across the two allocation paths (record-time
-- FIFO in allocateClientReceipt + the credit-application path) could therefore
-- over-apply an invoice and drive its outstanding negative, which then nets
-- against sibling invoices and understates receivables (getClientOverviewStats /
-- getClientReceivablesByProject sum outstanding with no per-row floor).
--
-- This adds the mirror trigger: for every affected client_invoice_txn_id, cap
--   Σ(LIVE allocations) <= Σ(1200 debit postings on that invoice txn).
-- "Live" = only allocations whose client_payment_txn_id is a POSTED, NON-REVERSED
-- receipt (status='posted' AND reverses_id IS NULL) — the same filter every read
-- path uses. Reversed receipts leave their allocation rows behind (reversal never
-- deletes them), so counting them would double-count an amend-&-reissue: the old
-- receipt is reversed (its allocations stop being live) and a corrected one is
-- recorded against the same invoice.
--
-- To make this an actual DB-level GUARANTEE (not just a snapshot check that two
-- concurrent inserts can both pass under READ COMMITTED), each iteration first
-- takes a FOR NO KEY UPDATE lock on the invoice's transactions row. Concurrent
-- allocation writers against the same invoice serialize on that row, so the
-- second one re-reads the first's committed rows before summing. FOR NO KEY
-- UPDATE (not FOR UPDATE) is deliberate: it does not conflict with the FK
-- KEY SHARE lock that inserting an allocation takes on the same invoice row, so
-- writers don't block each other during the INSERT itself — only at the check.
-- Invoice ids are locked in sorted order so a multi-invoice statement can't
-- deadlock against another.

CREATE OR REPLACE FUNCTION tg_receipt_allocation_invoice_cap_check_ins()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  invoice_debit bigint;
  sum_alloc bigint;
BEGIN
  FOR rec IN
    SELECT DISTINCT client_invoice_txn_id AS inv FROM new_table ORDER BY 1
  LOOP
    -- Serialize concurrent writers against this invoice (see header).
    PERFORM 1 FROM transactions WHERE id = rec.inv FOR NO KEY UPDATE;

    -- The invoice's 1200 Trade Receivables debit = its receivable capacity.
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO invoice_debit
      FROM postings p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.transaction_id = rec.inv
        AND p.side = 'debit'
        AND a.code = '1200';

    -- Σ over allocations whose receipt is a live (posted, non-reversed) txn.
    SELECT COALESCE(SUM(ra.amount_paise), 0)::bigint
      INTO sum_alloc
      FROM receipt_allocations ra
      JOIN transactions pt ON pt.id = ra.client_payment_txn_id
      WHERE ra.client_invoice_txn_id = rec.inv
        AND pt.status = 'posted'
        AND pt.reverses_id IS NULL;

    IF sum_alloc > invoice_debit THEN
      RAISE EXCEPTION
        'receipt_allocations sum % exceeds client_invoice 1200 receivable % (invoice_txn_id=%)',
        sum_alloc, invoice_debit, rec.inv
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tg_receipt_allocation_invoice_cap_check_upd()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  invoice_debit bigint;
  sum_alloc bigint;
BEGIN
  -- An UPDATE may re-point an allocation to a different invoice, so re-check
  -- both the new and old invoice ids (freeing capacity can't violate, but it's
  -- cheap and keeps the two branches symmetric).
  FOR rec IN
    SELECT inv FROM (
      SELECT client_invoice_txn_id AS inv FROM new_table
      UNION
      SELECT client_invoice_txn_id AS inv FROM old_table
    ) s
    ORDER BY inv
  LOOP
    PERFORM 1 FROM transactions WHERE id = rec.inv FOR NO KEY UPDATE;

    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint
      INTO invoice_debit
      FROM postings p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.transaction_id = rec.inv
        AND p.side = 'debit'
        AND a.code = '1200';

    SELECT COALESCE(SUM(ra.amount_paise), 0)::bigint
      INTO sum_alloc
      FROM receipt_allocations ra
      JOIN transactions pt ON pt.id = ra.client_payment_txn_id
      WHERE ra.client_invoice_txn_id = rec.inv
        AND pt.status = 'posted'
        AND pt.reverses_id IS NULL;

    IF sum_alloc > invoice_debit THEN
      RAISE EXCEPTION
        'receipt_allocations sum % exceeds client_invoice 1200 receivable % (invoice_txn_id=%)',
        sum_alloc, invoice_debit, rec.inv
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_receipt_allocation_invoice_cap_ins ON receipt_allocations;
--> statement-breakpoint
CREATE TRIGGER tg_receipt_allocation_invoice_cap_ins
  AFTER INSERT ON receipt_allocations
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_receipt_allocation_invoice_cap_check_ins();
--> statement-breakpoint

DROP TRIGGER IF EXISTS tg_receipt_allocation_invoice_cap_upd ON receipt_allocations;
--> statement-breakpoint
CREATE TRIGGER tg_receipt_allocation_invoice_cap_upd
  AFTER UPDATE ON receipt_allocations
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION tg_receipt_allocation_invoice_cap_check_upd();
--> statement-breakpoint
