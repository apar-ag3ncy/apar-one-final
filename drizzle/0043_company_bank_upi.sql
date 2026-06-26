-- 0043_company_bank_upi — add a UPI VPA to the agency's bank accounts.
--
-- Printed on the invoice payment block alongside the account/IFSC, and used
-- to render a scannable pay-by-UPI QR code that encodes the exact invoice
-- amount. Nullable — accounts without a UPI handle simply omit the QR.
ALTER TABLE "company_bank_accounts"
  ADD COLUMN IF NOT EXISTS "upi_id" text;
