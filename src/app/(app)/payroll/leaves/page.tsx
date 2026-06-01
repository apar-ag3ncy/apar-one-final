import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { LeavesClient } from './leaves-client';

export const metadata: Metadata = { title: 'Leave approvals · Apār Dashboard' };

// TODO(backend): swap for getLeaveQueue() once A ships.
const ROWS = [
  {
    id: 'lv1',
    requester: 'Anjali Mehta',
    submittedAt: '2026-05-12',
    summary: 'Casual leave',
    from: '2026-05-22',
    to: '2026-05-23',
    days: 2,
    status: 'pending' as const,
  },
  {
    id: 'lv2',
    requester: 'Riya Patel',
    submittedAt: '2026-05-10',
    summary: 'Earned leave · pre-wedding',
    from: '2026-06-15',
    to: '2026-06-25',
    days: 9,
    status: 'pending' as const,
  },
];

export default function LeavesPage() {
  return (
    <>
      <ProfileHeader
        title="Leave approvals"
        subtitle="Manager-approval queue. Balance enforcement and clash detection (with team-wide leave calendar) live on the server side."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <LeavesClient rows={ROWS} />
    </>
  );
}
