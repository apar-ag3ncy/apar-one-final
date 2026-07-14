-- 0069_move_salary_out_of_office_expenses — one-off (operator-approved).
--
-- The 11 salary payouts that had been captured as office expenses are now real
-- salary payments (salary_payments + Dr 6100 Salaries & Wages / Cr 1110 Cash),
-- recorded through recordSalaryPayment and reconciled 1:1 on (date, amount) for
-- Rs 7,13,000. Preyansh Vora and Sachin Yadav were added as employees so they
-- could be paid properly.
--
-- Until this migration runs, the books DOUBLE-COUNT: the original office
-- journals (Dr 6900 Other OpEx / Cr 1110) still stand alongside the new salary
-- journals, crediting cash twice. This deletes the 11 office_expenses rows and
-- their 11 posted 6900 journals + 22 postings, leaving exactly one journal per
-- payment and reclassifying the expense from Other OpEx to Salaries & Wages.
-- Cash impact is unchanged.
--
-- Verified before authoring: none of these 11 journals is referenced by
-- salary_payments, and every one debits 6900 only. Rows addressed by explicit
-- primary key; re-running is a no-op. Same trigger-neutralisation as 0067/0068.

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $neutralised$
BEGIN
  RETURN OLD;
END;
$neutralised$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $wipe$
DECLARE
  v_txns uuid[] := ARRAY[
    '2d18652a-5bde-44ef-bd4f-f26a56c07a20',
    'f7a97e1c-e62f-49ee-b8ca-dbaccc7c2768',
    'd0b572e7-8e94-404d-91a4-31be294e1121',
    'cdc795db-ba8f-4c63-85f9-20e894b2c6a5',
    '14ca4320-ab65-495b-bf33-85f5296123ce',
    '66f68bf3-445c-4f52-8c1e-7f4097db4d17',
    '35a19af3-b6b3-487e-92de-a78dd85e22a1',
    'a32aa89c-e56e-4246-86cb-c9f5436cb5eb',
    'fdc35745-3fac-4c64-a0fc-0fab787d11e0',
    '3d941a0b-24be-4774-b619-66bda7bddee9',
    '6f2a59c0-5f3d-4557-ac99-c47da1a8745b'
  ]::uuid[];
  v_exps uuid[] := ARRAY[
    '692b7360-c33d-47d6-8147-85cc3ab7e867',
    'c7e48fd9-620d-4f7c-a477-b9996eb1ed4c',
    '18e6360f-40ea-49c2-9185-82bf67b53968',
    '1cf45b45-3a5a-4220-9a74-c5ee08bde35f',
    '96f1a219-c34a-4b66-bdbc-a3c92cdbbf58',
    '4b74a580-b37d-4982-a591-d211c6826f23',
    '48f97311-1e44-4927-a93b-e61195b19e65',
    '2b6f77df-f313-46c3-8d33-e77561951f7b',
    'f3466545-fcee-4951-98c6-7360feda3d81',
    '4badbf4f-53e7-4e9e-af80-51ca3de58e55',
    '60e68f9c-b998-46a5-9943-9a076c25e1a2'
  ]::uuid[];
  n integer;
BEGIN
  DELETE FROM public.postings WHERE transaction_id = ANY(v_txns);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0069: deleted % postings', n;

  DELETE FROM public.office_expenses WHERE id = ANY(v_exps);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0069: deleted % office_expenses', n;

  DELETE FROM public.transactions WHERE id = ANY(v_txns);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0069: deleted % transactions', n;
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
DECLARE v_oe integer; v_sal integer;
BEGIN
  IF position('DELETE forbidden' in pg_get_functiondef('public.tg_block_delete_ledger()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0069: ledger delete-protection was not restored; aborting';
  END IF;

  SELECT count(*) INTO v_oe FROM public.office_expenses WHERE deleted_at IS NULL;
  IF v_oe <> 0 THEN
    RAISE EXCEPTION '0069: expected 0 office_expenses left, found %', v_oe;
  END IF;

  -- The 11 relocated payouts must survive, be posted, and total Rs 7,13,000.
  SELECT count(*) INTO v_sal
  FROM public.salary_payments
  WHERE deleted_at IS NULL
    AND notes LIKE '%moved from office expenses%'
    AND transaction_id IS NOT NULL;
  IF v_sal <> 11 THEN
    RAISE EXCEPTION '0069: expected the 11 relocated salary payments, found %', v_sal;
  END IF;

  IF (SELECT coalesce(sum(amount_paise), 0)
      FROM public.salary_payments
      WHERE deleted_at IS NULL AND notes LIKE '%moved from office expenses%') <> 71300000 THEN
    RAISE EXCEPTION '0069: the relocated salary payments do not total Rs 7,13,000';
  END IF;

  RAISE NOTICE '0069: office book empty, all 11 relocated salary payments intact';
END
$guard$;
