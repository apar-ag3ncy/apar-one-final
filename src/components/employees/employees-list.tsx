'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, Trash2Icon, UserCogIcon } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table';
import type { ActionBarAction } from '@/components/data-table/data-table-action-bar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { archiveEmployees, hardDeleteEmployees } from '@/lib/server/entities/employees';
import { employeeColumns } from './columns';
import type { Employee } from './types';

export type EmployeesListProps = {
  data: readonly Employee[];
  canArchive?: boolean;
  canHardDelete?: boolean;
};

export function EmployeesList({
  data,
  canArchive = false,
  canHardDelete = false,
}: EmployeesListProps) {
  const router = useRouter();
  const [pendingArchive, setPendingArchive] = useState<readonly string[] | null>(null);
  const [pendingHardDelete, setPendingHardDelete] = useState<readonly string[] | null>(null);

  const actions: ActionBarAction<Employee>[] = [
    {
      id: 'archive',
      label: 'Archive',
      visible: canArchive,
      icon: <ArchiveIcon className="size-4" aria-hidden />,
      onSelect: (rows) => setPendingArchive(rows.map((r) => r.original.id)),
    },
    {
      id: 'hard-delete',
      label: 'Delete permanently',
      tone: 'destructive',
      visible: canHardDelete,
      icon: <Trash2Icon className="size-4" aria-hidden />,
      onSelect: (rows) => setPendingHardDelete(rows.map((r) => r.original.id)),
    },
  ];

  async function confirmArchive() {
    const ids = pendingArchive;
    if (!ids) return;
    try {
      await archiveEmployees(ids);
      toast.success(ids.length === 1 ? 'Employee archived.' : `${ids.length} employees archived.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive employees.');
    } finally {
      setPendingArchive(null);
    }
  }

  async function confirmHardDelete() {
    const ids = pendingHardDelete;
    if (!ids) return;
    try {
      const result = await hardDeleteEmployees(ids);
      if (result.blocked.length > 0) {
        toast.warning(
          `${result.deleted} deleted; ${result.blocked.length} blocked by referenced transactions or salary history.`,
        );
      } else {
        toast.success(
          ids.length === 1
            ? 'Employee deleted permanently.'
            : `${ids.length} employees deleted permanently.`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete employees.');
    } finally {
      setPendingHardDelete(null);
    }
  }

  return (
    <>
      <DataTable
        columns={employeeColumns}
        data={data as Employee[]}
        exportFilename="employees"
        initialSorting={[{ id: 'joinedAt', desc: false }]}
        searchPlaceholder="Search name, designation, department…"
        tableKey="employees.list"
        bulkActions={actions}
        bulkEntityLabel={{ singular: 'employee', plural: 'employees' }}
        emptyState={{
          icon: UserCogIcon,
          title: 'No employees yet',
          description:
            'Add the first employee to start tracking KYC, contracts, leaves, and reviews.',
        }}
      />

      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(v) => {
          if (!v) setPendingArchive(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {pendingArchive?.length ?? 0}{' '}
              {pendingArchive?.length === 1 ? 'employee' : 'employees'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archive marks the employee as separated. Their salary history, reimbursements, and
              documents stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingHardDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingHardDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {pendingHardDelete?.length ?? 0}{' '}
              {pendingHardDelete?.length === 1 ? 'employee' : 'employees'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Employees with non-reversed transactions or any salary history
              will be blocked from this delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmHardDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
