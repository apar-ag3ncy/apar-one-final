import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
import { EmployeeDesktop } from '@/components/employee-os/employee-desktop';
import { currentEmployee } from '@/lib/server/employee-auth';
import './os.css';

export const metadata: Metadata = {
  title: 'Apar One · Desktop Demo',
  description:
    'Demo-grade desktop OS shell for the Apar dashboard — sample data only, no real backend.',
};

// Server Actions invoked from the OS shell inherit this page's timeout budget
// (Next 16 route segment config — see maxDuration docs). The batched
// `importOfficeExpenses` is now a small constant number of round-trips, but this
// is a safety net for very large sheets (up to the 2000-row cap) so the function
// returns cleanly instead of being killed at the platform's short default.
export const maxDuration = 60;

export default async function OsPage() {
  // An employee session routes to the restricted employee workspace — a wholly
  // separate shell from the admin desktop, so no accounting surface is ever
  // rendered for them. Operators (os_users) have no employee cookie and fall
  // through to the full OsRoot.
  const employee = await currentEmployee();
  if (employee) return <EmployeeDesktop employee={employee} />;
  return <OsRoot />;
}
