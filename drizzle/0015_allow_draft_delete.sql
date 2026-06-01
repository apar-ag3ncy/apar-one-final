-- 0015_allow_draft_delete — let users discard / replace draft transactions.
--
-- LEDGER-SPEC §0.3 / §8.5 say "posted transactions are immutable —
-- reverse, never delete". The existing tg_block_delete_ledger trigger
-- enforces that, but it blocks every delete unconditionally — including
-- drafts that haven't been posted yet. That makes the draft workflow
-- (capture → review flags → post OR discard) impossible: the only way
-- out of a draft is forward.
--
-- This migration:
--   1. Replaces tg_block_delete_ledger() so it only blocks deletes when
--      the row's status is 'posted' or 'reversed'. Drafts pass through.
--   2. Re-attaches a row-level trigger (was STATEMENT) so the function
--      can see OLD.status — STATEMENT-level triggers don't get a row.
--
-- Postings have no status of their own; they inherit it from their
-- transaction. The trigger on postings looks the status up via a
-- subquery so a posting belonging to a posted transaction stays
-- delete-blocked even when the user tries to nuke a single leg.

CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $$
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
    RAISE EXCEPTION 'DELETE forbidden on ledger table % when status = %. LEDGER-SPEC §0.3 / §8.5. Reverse instead.', TG_TABLE_NAME, v_status;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- The old triggers were STATEMENT-level; we need ROW-level now so OLD is
-- populated. Drop + recreate.

DROP TRIGGER IF EXISTS trg_transactions_block_delete ON public.transactions;
--> statement-breakpoint
CREATE TRIGGER trg_transactions_block_delete
  BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_delete_ledger();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_postings_block_delete ON public.postings;
--> statement-breakpoint
CREATE TRIGGER trg_postings_block_delete
  BEFORE DELETE ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_delete_ledger();
