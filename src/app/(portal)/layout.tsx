import { redirect } from 'next/navigation';

import { currentEmployee } from '@/lib/server/employee-auth';

/**
 * DEPRECATED — the `/me` self-service portal has been replaced by the employee
 * workspace inside the OS (`/os` → EmployeeDesktop). This layout now just
 * forwards: signed-in employees go to `/os`, everyone else to `/login`. The old
 * portal pages under this group are dead and can be removed in a later cleanup.
 */
export default async function PortalLayout({ children: _children }: { children: React.ReactNode }) {
  const employee = await currentEmployee();
  redirect(employee ? '/os' : '/login');
}
