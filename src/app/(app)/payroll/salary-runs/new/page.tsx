import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { SalaryRunWizardClient } from './salary-run-wizard-client';
import { listEmployees } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'New salary run · Apār Dashboard' };

export default async function NewSalaryRunPage() {
  const employees = await listEmployees();
  return (
    <>
      <ProfileHeader
        title="New salary run"
        subtitle="Generate the month from active salary structures, edit line-by-line, upload a consolidated sheet if you prefer, review, post atomically."
        back={{ href: '/payroll/salary-runs', label: 'Salary runs' }}
      />
      <SalaryRunWizardClient
        employees={employees.map((e) => ({ id: e.id, fullName: e.fullName }))}
      />
    </>
  );
}
