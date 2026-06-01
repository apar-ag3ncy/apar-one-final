-- Billing Phase 1.2 — chart of accounts additions for the billing module.
--
-- LEDGER-SPEC §10.1 seeded a 25-account starter chart (in 0007_ledger.sql
-- lines 94-126). The billing module needs two more accounts that aren't
-- in that set:
--
--   1252 Advance-Output-GST-Asset (asset, non-control)
--     - Holds the output-GST liability we recognise on advance receipts
--       (CGST Rule 50). Unwound when the invoice is later raised and
--       allocated against the advance.
--     - Phase 4.6 postings:
--         Dr 1252 (asset)   Cr 2120 GST Output Payable
--       And Phase 4.7 unwind:
--         Dr 2120           Cr 1252
--
--   6600 Bank Charges (expense, non-control)
--     - Razorpay (and other gateway) fees deducted from each captured
--       payment. Phase 4.4 webhook posting:
--         Dr 1120 Bank (receipt net of fee) + Dr 6600 (fee)
--         Cr 1200 Trade Receivables (sub: client) (gross)
--     - Was previously folded into 6900 Other OpEx per the original spec
--       (line 272 of 0007_ledger.sql). Splitting it out keeps the
--       gateway-fee report a single account-code query instead of a
--       metadata-tagged subset of 6900.
--
-- Idempotent: ON CONFLICT (code) DO NOTHING so re-running this migration
-- is safe even if a partner has manually inserted these codes via the
-- admin UI in the meantime.

INSERT INTO accounts (code, name, type, is_control, currency, metadata)
VALUES
  (
    '1252',
    'Advance-Output-GST-Asset',
    'asset',
    false,
    'INR',
    jsonb_build_object(
      'purpose', 'GST output liability recognised on customer advances (Rule 50); unwound when invoice raised and allocated.',
      'added_in', '0020_billing_chart_accounts'
    )
  ),
  (
    '6600',
    'Bank Charges',
    'expense',
    false,
    'INR',
    jsonb_build_object(
      'purpose', 'Payment-gateway fees (Razorpay etc.) deducted from captured payments.',
      'added_in', '0020_billing_chart_accounts'
    )
  )
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
