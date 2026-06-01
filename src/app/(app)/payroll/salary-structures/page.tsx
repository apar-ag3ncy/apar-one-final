import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { SalaryStructuresClient } from './salary-structures-client';
import { listEmployees } from '@/lib/server-stub/entity-actions';

export const metadata: Metadata = { title: 'Salary structures · Apār Dashboard' };

export default async function SalaryStructuresPage() {
  const employees = await listEmployees();
  return (
    <>
      <ProfileHeader
        title="Salary structures"
        subtitle="Per-employee compensation template. Each save creates a new version — historical pay runs reference the version that was active on the run date."
        back={{ href: '/payroll', label: 'Payroll' }}
      />
      <SalaryStructuresClient
        employees={employees.map((e) => ({ id: e.id, fullName: e.fullName }))}
      />
    </>
  );
}
