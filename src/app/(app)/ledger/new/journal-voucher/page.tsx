import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { JournalVoucherForm } from './journal-voucher-form';

export const metadata: Metadata = { title: 'Journal voucher · Apār Dashboard' };

export default function JournalVoucherPage() {
  return (
    <>
      <ProfileHeader
        title="Journal voucher"
        subtitle="Partner-only. Free-form double-entry — every legitimate use case has a typed transaction kind; reach for this one only when none fits."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <JournalVoucherForm />
    </>
  );
}
