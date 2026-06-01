import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { AgencyBanksClient } from './agency-banks-client';
import type { BankAccount } from '@/types/api';

export const metadata: Metadata = { title: 'Agency bank accounts · Apār Dashboard' };

// TODO(backend): swap for getAgencyBankAccounts() once A ships.
const ACCOUNTS: readonly BankAccount[] = [
  {
    id: '1100',
    bankName: 'HDFC Bank',
    maskedNumber: 'XXXX XXXX 1234',
    ifsc: 'HDFC0000123',
    holderName: 'Apār LLP',
    accountType: 'Current',
    branch: 'Lower Parel, Mumbai',
    isPrimary: true,
  },
  {
    id: '1110',
    bankName: 'ICICI Bank',
    maskedNumber: 'XXXX XXXX 5678',
    ifsc: 'ICIC0000456',
    holderName: 'Apār LLP',
    accountType: 'Current',
    branch: 'Bandra Kurla Complex, Mumbai',
  },
];

export default function AgencyBanksPage() {
  return (
    <>
      <ProfileHeader
        title="Agency bank accounts"
        subtitle="The accounts Apār invoices payments into and pays vendors from. Full numbers live in the vault; reveal is audit-logged."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <AgencyBanksClient accounts={ACCOUNTS} />
      <p className="text-muted-foreground mt-3 text-xs">
        Add / edit / archive lands once Backend ships `setAgencyBankAccount` with vault upsert. Each
        agency account points at a GL account code (1100 HDFC, 1110 ICICI, 1150 Cash) so the ledger
        knows which Bank ledger to post to.
      </p>
    </>
  );
}
