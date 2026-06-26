import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { VendorBillForm } from './vendor-bill-form';
import { listClients, listVendors, listProjects } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = {
  title: 'New vendor bill · Apar Dashboard',
};

export default async function NewVendorBillPage() {
  const [vendors, clients, projects] = await Promise.all([
    listVendors(),
    listClients(),
    listProjects(),
  ]);
  return (
    <>
      <ProfileHeader
        title="New vendor bill"
        subtitle={
          <>
            First required answer: is this bill for a client, OpEx, or an asset? Per LEDGER-SPEC
            §0.6, per-client profitability depends on this attribution — the form structure changes
            accordingly and the server refuses without it.
          </>
        }
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <VendorBillForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        projects={projects.map((p) => ({
          id: p.id,
          clientId: p.clientId,
          code: p.code,
          name: p.name,
        }))}
      />
    </>
  );
}
