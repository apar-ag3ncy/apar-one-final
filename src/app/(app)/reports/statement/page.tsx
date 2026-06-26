import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { getStatementOfAccount } from '@/lib/server-stub/ledger-actions';
import { listClients, listVendors } from '@/lib/server-stub/entity-actions';
import { StatementClient } from './statement-client';

export const metadata: Metadata = { title: 'Statement of account · Apar Dashboard' };

type Props = {
  searchParams: Promise<{
    side?: 'client' | 'vendor';
    id?: string;
    from?: string;
    to?: string;
  }>;
};

export default async function StatementPage({ searchParams }: Props) {
  const sp = await searchParams;
  const side: 'client' | 'vendor' = sp.side === 'vendor' ? 'vendor' : 'client';
  const [clients, vendors] = await Promise.all([listClients(), listVendors()]);
  const id = sp.id ?? (side === 'client' ? clients[0]?.id : vendors[0]?.id);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = sp.from ?? `${new Date().getFullYear()}-04-01`;
  const toDate = sp.to ?? today;

  const rows = id
    ? await getStatementOfAccount({ entityType: side, entityId: id, fromDate, toDate })
    : [];

  return (
    <>
      <ProfileHeader
        title="Statement of account"
        subtitle="Chronological postings + running balance for a single client or vendor. Drill into any row to see the underlying transaction."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <StatementClient
        side={side}
        id={id}
        fromDate={fromDate}
        toDate={toDate}
        rows={rows}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
      />
    </>
  );
}
