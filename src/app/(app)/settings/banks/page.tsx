import { redirect } from 'next/navigation';

// The agency bank-account list now lives at Settings → Billing, backed by the
// real `company_bank_accounts` table (full CRUD, copyable numbers, primary /
// secondary). The old hardcoded stub here is superseded; keep the route alive
// by redirecting any bookmarks.
export default function AgencyBanksPage() {
  redirect('/settings/billing');
}
