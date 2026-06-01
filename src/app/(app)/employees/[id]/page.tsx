import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmployeeDetailTabs } from '@/components/employees/employee-detail-tabs';
import { getEmployee } from '@/lib/server-stub/entity-actions';
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
  // TODO(backend): swap for getEmployee(id) once Backend ships the query helper, with role-aware
  // KYC masking enforced server-side.
  const employee = await getEmployee(id);
  if (!employee) notFound();

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
            <Button
              size="sm"
              variant="outline"
              disabled
              title="Server action pending (Backend agent)."
            >
              Edit
            </Button>
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
