import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { AdvanceReceivedForm } from './advance-received-form';
import { listClients } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Advance received · Apar Dashboard' };

export default async function AdvanceReceivedPage() {
  const clients = await listClients();
  return (
    <>
      <ProfileHeader
        title="Advance received"
        subtitle="Posts to 2180 Advances received from clients (LEDGER-SPEC §10.1) — kept separate from accounts payable so refunds don't trigger AR offsets."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <AdvanceReceivedForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
