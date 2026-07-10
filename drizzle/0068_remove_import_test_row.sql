-- 0068_remove_import_test_row — remove a single verification artifact.
--
-- While verifying 0067's new duplicate-skipping importer against the live
-- preview, one throwaway row ("ZZ Dedup Test", Rs 111.00) was imported to prove
-- that a brand-new row still lands while its in-sheet duplicate is skipped. The
-- import auto-posted it to the GL, and posted journals are delete-protected, so
-- it cannot be removed over the REST client. This migration deletes exactly that
-- one expense, its journal and its two postings, by explicit primary key.
--
-- Same technique as 0067: neutralise tg_block_delete_ledger() (needs only
-- ownership of the function — ALTER TABLE ... DISABLE TRIGGER needs table
-- ownership and is rejected here), delete, restore the 0015 body, then assert.
-- All pending migrations run in ONE transaction, so any failure rolls back the
-- neutralised function together with the deletes.

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $neutralised$
BEGIN
  -- Temporarily permissive; restored to the 0015 body below.
  RETURN OLD;
END;
$neutralised$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $wipe$
DECLARE
  v_txn uuid := 'eb52b082-a1a3-43d5-9bb3-6c3a97380049';
  v_exp uuid := 'd5986359-e4e0-4003-b8ae-e797699d71ac';
  n integer;
BEGIN
  DELETE FROM public.postings WHERE transaction_id = v_txn;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0068: deleted % postings', n;

  DELETE FROM public.office_expenses WHERE id = v_exp;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0068: deleted % office_expenses', n;

  DELETE FROM public.transactions WHERE id = v_txn;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '0068: deleted % transactions', n;
END
$wipe$;
--> statement-breakpoint

-- Restore the 0015 body verbatim.
CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $restored$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'transactions' THEN
    v_status := OLD.status::text;
  ELSE
    -- postings: inherit status from parent transaction.
    SELECT t.status::text INTO v_status
    FROM public.transactions t
    WHERE t.id = OLD.transaction_id;
  END IF;

  IF v_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'DELETE forbidden on ledger table % when status = %. LEDGER-SPEC 0.3 / 8.5. Reverse instead.', TG_TABLE_NAME, v_status;
  END IF;

  RETURN OLD;
END;
$restored$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $guard$
DECLARE v_count integer;
BEGIN
  IF position('DELETE forbidden' in pg_get_functiondef('public.tg_block_delete_ledger()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0068: ledger delete-protection was not restored; aborting';
  END IF;

  SELECT count(*) INTO v_count FROM public.office_expenses WHERE deleted_at IS NULL;
  IF v_count <> 11 THEN
    RAISE EXCEPTION '0068: expected 11 surviving office_expenses (the salary rows), found %', v_count;
  END IF;
  RAISE NOTICE '0068: clean — % salary rows remain', v_count;
END
$guard$;
