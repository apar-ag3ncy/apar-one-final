import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ClientInvoiceForm } from './client-invoice-form';
import { listClients, listProjects } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'New client invoice · Apar Dashboard' };

export default async function NewClientInvoicePage() {
  const [clients, projects] = await Promise.all([listClients(), listProjects()]);
  return (
    <>
      <ProfileHeader
        title="New client invoice"
        subtitle="Line items with GST per line. Posts to 1200 Receivables + 4100 Service revenue + 2160/2170 Output GST."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <ClientInvoiceForm
        clientOptions={clients.map((c) => ({ value: c.id, label: c.name }))}
        projectOptions={projects.map((p) => ({
          value: p.id,
          label: `${p.code} — ${p.name}`,
        }))}
      />
    </>
  );
}
