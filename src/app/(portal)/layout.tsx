import { redirect } from 'next/navigation';

import { currentEmployee } from '@/lib/server/employee-auth';

/**
 * DEPRECATED — the `/me` self-service portal is gone; the employee experience
 * now lives at `/employee` (its own OS shell). This layout just forwards:
 * signed-in employees → `/employee`, everyone else → `/login`.
 */
export default async function PortalLayout() {
  const employee = await currentEmployee();
  redirect(employee ? '/employee' : '/os');
}
