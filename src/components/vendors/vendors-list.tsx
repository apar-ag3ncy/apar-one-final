'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, Trash2Icon, TruckIcon } from 'lucide-react';
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
import { archiveVendors, hardDeleteVendors } from '@/lib/server/entities/vendors';
import { vendorColumns } from './columns';
import type { Vendor } from './types';

export type VendorsListProps = {
  data: readonly Vendor[];
  canArchive?: boolean;
  canHardDelete?: boolean;
};

export function VendorsList({ data, canArchive = false, canHardDelete = false }: VendorsListProps) {
  const router = useRouter();
  const [pendingArchive, setPendingArchive] = useState<readonly string[] | null>(null);
  const [pendingHardDelete, setPendingHardDelete] = useState<readonly string[] | null>(null);

  const actions: ActionBarAction<Vendor>[] = [
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
      await archiveVendors(ids);
      toast.success(ids.length === 1 ? 'Vendor archived.' : `${ids.length} vendors archived.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive vendors.');
    } finally {
      setPendingArchive(null);
    }
  }

  async function confirmHardDelete() {
    const ids = pendingHardDelete;
    if (!ids) return;
    try {
      const result = await hardDeleteVendors(ids);
      if (result.blocked.length > 0) {
        toast.warning(
          `${result.deleted} deleted; ${result.blocked.length} blocked by referenced transactions. Reverse those first.`,
        );
      } else {
        toast.success(
          ids.length === 1
            ? 'Vendor deleted permanently.'
            : `${ids.length} vendors deleted permanently.`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete vendors.');
    } finally {
      setPendingHardDelete(null);
    }
  }

  return (
    <>
      <DataTable
        columns={vendorColumns}
        data={data as Vendor[]}
        exportFilename="vendors"
        initialSorting={[{ id: 'outstandingPaise', desc: true }]}
        searchPlaceholder="Search vendors, category, GSTIN…"
        tableKey="vendors.list"
        bulkActions={actions}
        bulkEntityLabel={{ singular: 'vendor', plural: 'vendors' }}
        emptyState={{
          icon: TruckIcon,
          title: 'No vendors yet',
          description: 'Add the first vendor to track invoices, contracts, and payments.',
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
              {pendingArchive?.length === 1 ? 'vendor' : 'vendors'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archived vendors are hidden from the default list but remain queryable. Their bills,
              payments, and documents stay intact.
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
              {pendingHardDelete?.length === 1 ? 'vendor' : 'vendors'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Vendors with non-reversed bills will be blocked from this
              delete; reverse those transactions first or archive the vendor instead.
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
