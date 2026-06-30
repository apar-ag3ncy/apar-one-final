import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import {
  getGeneralLedger,
  listLedgerAccounts,
  type Statement,
} from '@/lib/server/ledger/statements';
import { GeneralLedgerClient } from './general-ledger-client';

export const metadata: Metadata = { title: 'General ledger · Apar Dashboard' };

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const accounts = await listLedgerAccounts();
  const account = sp.account ?? accounts[0]?.code;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? `${new Date().getFullYear()}-04-01`;
  const to = sp.to ?? today;
  const statement: Statement = account
    ? await getGeneralLedger({ accountCode: account, from, to })
    : { closingBalancePaise: 0n, lines: [] };
  return (
    <>
      <ProfileHeader
        title="General ledger"
        subtitle="Every posting on one account, oldest first, with a running balance — the detail behind the trial balance."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <GeneralLedgerClient
        account={account}
        from={from}
        to={to}
        accounts={accounts}
        statement={statement}
      />
    </>
  );
}
