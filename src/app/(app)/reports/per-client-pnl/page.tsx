import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getPerClientPnL } from '@/lib/server-stub/ledger-actions';
import { PerClientPnLTable } from './per-client-pnl-table';

export const metadata: Metadata = {
  title: 'Per-client P&L · Apar Dashboard',
};

type Props = {
  searchParams: Promise<{ from?: string; to?: string }>;
};

function defaultRange() {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export default async function PerClientPnLPage({ searchParams }: Props) {
  const sp = await searchParams;
  const fromDate = sp.from ?? defaultRange().fromDate;
  const toDate = sp.to ?? defaultRange().toDate;
  const rows = await getPerClientPnL({ fromDate, toDate });

  return (
    <>
      <ProfileHeader
        title="Per-client P&L"
        subtitle={
          <>
            Revenue, direct cost, gross margin — by client. Click a row to drill into that
            client&apos;s transactions for the same range. Numbers come from posted transactions
            only.
          </>
        }
        back={{ href: '/reports', label: 'All reports' }}
      />
      <PerClientPnLTable rows={rows} fromDate={fromDate} toDate={toDate} />
    </>
  );
}
