-- Client-side TDS + richer payment/receipt capture.
--
-- 1) New asset account 1260 "TDS Receivable" — TDS withheld by CLIENTS when
--    they pay us. Client-withheld TDS previously had no ledger home; it was
--    captured on receipts.captured_tds_amount_paise as pure metadata, so an
--    invoice paid net-of-TDS stayed forever "partially due" by the TDS amount.
--    With 1260, a receipt posts the 3-leg entry
--        Dr 1120/1110 (cash net)  +  Dr 1260 (TDS)  /  Cr 1200 (gross)
--    so the receivable is fully settled and the TDS credit is tracked as an
--    asset we can reconcile against our income-tax credit later. Non-control
--    (no per-client sub-ledger) — mirrors 1250 GST Input Credit.
--
-- 2) Two informational columns on `receipts`, captured-not-computed and shown
--    on the receipt voucher / Payments tab for transparency:
--      - counterparty_bank_account_id → which of the CLIENT's saved bank
--        accounts the money came from (entity_bank_accounts). Their account,
--        not in our chart of accounts, so no posting — traceability only.
--      - captured_gst_amount_paise → GST portion of the payment, recorded for
--        the record (GST itself is posted at invoice time, not here).

-- Idempotent: on the shared prod DB `1260` may already exist (main's
-- 0049_client_receipts seeds it) and the columns may be partially present, so
-- guard every statement — this migration must be safe to (re-)apply on top of
-- either a fresh branch DB or the main-advanced prod DB.
INSERT INTO "accounts" (code, name, type, is_control, subledger_kind) VALUES
  ('1260', 'TDS Receivable', 'asset', false, NULL)
  ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "counterparty_bank_account_id" uuid
    REFERENCES "entity_bank_accounts"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "receipts"
  ADD COLUMN IF NOT EXISTS "captured_gst_amount_paise" bigint DEFAULT 0 NOT NULL;
