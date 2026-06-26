import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { PaymentMadeForm } from './payment-made-form';
import { listVendors, listEmployees } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Payment made · Apar Dashboard' };

export default async function PaymentMadePage() {
  const [vendors, employees] = await Promise.all([listVendors(), listEmployees()]);
  return (
    <>
      <ProfileHeader
        title="Payment made"
        subtitle="Vendor settlements + employee reimbursements share this flow. Choose the counterparty kind."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <PaymentMadeForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        employees={employees.map((e) => ({ id: e.id, name: e.fullName }))}
      />
    </>
  );
}
