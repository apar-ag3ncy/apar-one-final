import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { OfficeExpenseForm } from './office-expense-form';

export const metadata: Metadata = { title: 'Office expense · Apar Dashboard' };

export default function OfficeExpensePage() {
  return (
    <>
      <ProfileHeader
        title="Office expense"
        subtitle="Quick-entry path for petty cash / card spend with no vendor invoice. Bank/cash credit, expense account (6xxx) debit."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <OfficeExpenseForm />
    </>
  );
}
