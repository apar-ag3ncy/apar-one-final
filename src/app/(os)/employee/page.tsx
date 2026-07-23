import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { currentEmployee } from '@/lib/server/employee-auth';
import { EmployeeOs } from '@/components/employee-os/employee-os';
import '../os/os.css';

export const metadata: Metadata = {
  title: 'Apār · My Workspace',
};

// Server-action budget for the employee apps (mirrors the /os page).
export const maxDuration = 60;

export default async function EmployeePage() {
  // Authoritative gate: only a valid employee session renders the workspace.
  // If the cookie can't resolve to a live employee (deactivated, password
  // reset, revoked, or stale/forged) we go through /employee/exit, which clears
  // the dead cookie before /os — redirecting straight to /os would loop, since
  // the presence-only middleware keeps bouncing /os back to /employee while the
  // cookie lingers. The admin OS is never rendered here (this shell imports
  // none of it).
  const employee = await currentEmployee();
  if (!employee) redirect('/employee/exit');
  return <EmployeeOs employee={employee} />;
}
