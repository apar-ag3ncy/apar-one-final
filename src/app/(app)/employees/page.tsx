import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmployeesList } from '@/components/employees/employees-list';
import { ImportEmployeesDialog } from '@/components/employees/import-employees-dialog';
import { listEmployees } from '@/lib/server-stub/entity-actions';
import { getActorContext } from '@/lib/server/actor';
import { hasCapability } from '@/lib/rbac';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Employees · Apar Dashboard',
};

export default async function EmployeesPage() {
  const [data, actor] = await Promise.all([listEmployees(), getActorContext()]);
  const active = data.filter((e) => e.status === 'active').length;
  const canArchive = hasCapability(actor, 'archive_employee');
  const canHardDelete = actor.role === 'partner';
  return (
    <>
      <PageHeader
        title="Employees"
        description={`${data.length} total · ${active} active. KYC remains masked on this list — restricted-bucket docs require role + signed URL.`}
        actions={
          <div className="flex items-center gap-2">
            <ImportEmployeesDialog />
            <Button asChild size="sm">
              <Link href="/employees/new">New employee</Link>
            </Button>
          </div>
        }
      />
      <EmployeesList data={data} canArchive={canArchive} canHardDelete={canHardDelete} />
    </>
  );
}
