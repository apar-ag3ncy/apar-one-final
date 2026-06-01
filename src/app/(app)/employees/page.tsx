import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmployeesList } from '@/components/employees/employees-list';
import { listEmployees } from '@/lib/server-stub/entity-actions';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Employees · Apār Dashboard',
};

export default async function EmployeesPage() {
  const data = await listEmployees();
  const active = data.filter((e) => e.status === 'active').length;
  return (
    <>
      <PageHeader
        title="Employees"
        description={`${data.length} total · ${active} active. KYC remains masked on this list — restricted-bucket docs require role + signed URL.`}
        actions={
          <Button asChild size="sm">
            <Link href="/employees/new">New employee</Link>
          </Button>
        }
      />
      <EmployeesList data={data} />
    </>
  );
}
