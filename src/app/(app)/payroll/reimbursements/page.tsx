import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ReimbursementsClient } from './reimbursements-client';

export const metadata: Metadata = { title: 'Reimbursement queue · Apār Dashboard' };

// TODO(backend): swap for getReimbursementQueue() once A ships.
const ROWS = [
  {
    id: 'r1',
    requester: 'Anjali Mehta',
    submittedAt: '2026-05-14',
    summary: 'Client site visit · cab + meals',
    amountPaise: 4_250_00n,
    receiptCount: 3,
    status: 'pending' as const,
  },
  {
    id: 'r2',
    requester: 'Riya Patel',
    submittedAt: '2026-05-08',
    summary: 'Photographer per-diem',
    amountPaise: 12_000_00n,
    receiptCount: 1,
    status: 'pending' as const,
  },
  {
    id: 'r3',
    requester: 'Sahil Joshi',
    submittedAt: '2026-04-30',
    summary: 'Co-working day pass',
    amountPaise: 950_00n,
    receiptCount: 1,
    status: 'approved' as const,
  },
];

export default function ReimbursementsPage() {
  return (
    <>
      <ProfileHeader
        title="Reimbursement approvals"
        subtitle="Employee-submitted receipts pending manager / accountant sign-off. Approved items roll into the next salary run or pay separately depending on policy."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <ReimbursementsClient rows={ROWS} />
    </>
  );
}
