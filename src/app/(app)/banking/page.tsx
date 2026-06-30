import type { Metadata } from 'next';

import { BankAccountsManager } from '@/components/banking/bank-accounts-manager';
import { ProfileHeader } from '@/components/entity/profile-header';
import { listAgencyBankAccountsDetailed } from '@/lib/server/billing/agency-banks';

export const metadata: Metadata = { title: 'Banking · Apar Dashboard' };

export default async function BankingPage() {
  const banks = await listAgencyBankAccountsDetailed();
  return (
    <>
      <ProfileHeader
        title="Banking"
        subtitle="Your agency's own bank accounts. Set each account's opening balance and the date it was true; every recorded receipt and payment then tallies into a running balance you can open as a full bank book."
        back={{ href: '/', label: 'Dashboard' }}
      />
      <BankAccountsManager banks={banks} />
    </>
  );
}
