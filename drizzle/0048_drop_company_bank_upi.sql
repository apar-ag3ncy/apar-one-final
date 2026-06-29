-- 0046_drop_company_bank_upi — remove the UPI VPA from the agency's bank
-- accounts. The invoice payment block no longer prints a UPI ID or a
-- pay-by-UPI QR code (added in 0043); only the bank/account/IFSC details show.
-- IF EXISTS keeps this idempotent across environments where 0043 may not have
-- run.
ALTER TABLE "company_bank_accounts"
  DROP COLUMN IF EXISTS "upi_id";
