import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ExpenseOnBehalfForm } from './expense-on-behalf-form';
import { listClients, listVendors, listProjects } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Expense on behalf · Apār Dashboard' };

export default async function ExpenseOnBehalfPage() {
  const [clients, vendors, projects] = await Promise.all([
    listClients(),
    listVendors(),
    listProjects(),
  ]);
  return (
    <>
      <ProfileHeader
        title="Expense on behalf"
        subtitle="Outflows Apār pays on a client's behalf that get reimbursed (printing, travel, sub-vendor invoices). Surfaces in client P&L direct cost AND in the Expenses-on-behalf tab on that client's profile."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <ExpenseOnBehalfForm
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
      />
    </>
  );
}
