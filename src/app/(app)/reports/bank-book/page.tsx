import { redirect } from 'next/navigation';

// The bank book now lives under Banking, backed by the real `bank_accounts`
// sub-ledger of 1120 with opening balances and a per-account running balance
// (getBankBook). Keep this route alive for bookmarks.
export default function BankBookPage() {
  redirect('/banking');
}
