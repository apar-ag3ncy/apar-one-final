import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
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
  // Employees render the SAME OS desktop as operators, but OsRoot puts them in a
  // restricted role='employee' mode (only the employee apps; no accounting). The
  // /os UI split is backed by a server-side guard — getActorContext() denies
  // employee sessions any admin action (src/lib/server/actor.ts). Operators have
  // no employee cookie and get the os_users lock-screen flow.
  const employee = await currentEmployee();
  return <OsRoot employee={employee} />;
}
