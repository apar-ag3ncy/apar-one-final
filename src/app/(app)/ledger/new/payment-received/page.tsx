import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { PaymentReceivedForm } from './payment-received-form';
import { listClients } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Payment received · Apar Dashboard' };

export default async function PaymentReceivedPage() {
  const clients = await listClients();
  return (
    <>
      <ProfileHeader
        title="Payment received"
        subtitle="Match against open invoices or post unapplied (will surface as a credit balance until reconciled)."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <PaymentReceivedForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
