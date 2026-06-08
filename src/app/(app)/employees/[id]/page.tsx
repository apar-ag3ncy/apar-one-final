import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmployeeDetailTabs } from '@/components/employees/employee-detail-tabs';
import { EmployeeEditDialog } from '@/components/employees/employee-edit-dialog';
import { getEmployee } from '@/lib/server-stub/entity-actions';
import { getActorContext } from '@/lib/server/actor';
import { hasCapability } from '@/lib/rbac';
import type { EmployeeStatus } from '@/types/api';
import { ProfileHeader } from '@/components/entity/profile-header';
import type { StatusTone } from '@/components/shared/status-badge';

const STATUS_TONES: Record<EmployeeStatus, StatusTone> = {
  active: 'success',
  notice: 'warning',
  separated: 'neutral',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  notice: 'On notice',
  separated: 'Separated',
};

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const employee = await getEmployee(id);
  return {
    title: employee ? `${employee.fullName} · Apār Dashboard` : 'Employee · Apār Dashboard',
  };
}

export default async function EmployeeDetailPage({ params }: Props) {
  const { id } = await params;
  const [employee, actor] = await Promise.all([getEmployee(id), getActorContext()]);
  if (!employee) notFound();

  const canEdit = hasCapability(actor, 'update_employee');

  return (
    <>
      <ProfileHeader
        title={employee.fullName}
        subtitle={
          <>
            {employee.designation} · {employee.city}
          </>
        }
        status={{
          tone: STATUS_TONES[employee.status],
          label: STATUS_LABELS[employee.status],
        }}
        back={{ href: '/employees', label: 'All employees' }}
        actions={
          <>
            {canEdit ? (
              <EmployeeEditDialog employee={employee} />
            ) : (
              <Button size="sm" variant="outline" disabled title="Your role can't edit employees.">
                Edit
              </Button>
            )}
            <Button size="sm" disabled title="Server action pending (Backend agent).">
              Log activity
            </Button>
          </>
        }
      />
      <EmployeeDetailTabs employee={employee} />
    </>
  );
}
