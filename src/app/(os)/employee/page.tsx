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
  // A forged/absent cookie resolves to null → login. The admin OS is never
  // rendered here (this shell imports none of it).
  const employee = await currentEmployee();
  if (!employee) redirect('/os');
  return <EmployeeOs employee={employee} />;
}
