'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, Trash2Icon, UsersIcon } from 'lucide-react';
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
import { archiveClients, hardDeleteClients } from '@/lib/server/entities/clients';
import { clientColumns } from './columns';
import type { Client } from './types';

export type ClientsListProps = {
  data: readonly Client[];
  canArchive?: boolean;
  canHardDelete?: boolean;
};

export function ClientsList({ data, canArchive = false, canHardDelete = false }: ClientsListProps) {
  const router = useRouter();
  const [pendingArchive, setPendingArchive] = useState<readonly string[] | null>(null);
  const [pendingHardDelete, setPendingHardDelete] = useState<readonly string[] | null>(null);

  const actions: ActionBarAction<Client>[] = [
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
      await archiveClients(ids);
      toast.success(ids.length === 1 ? 'Client archived.' : `${ids.length} clients archived.`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not archive clients.';
      toast.error(msg);
    } finally {
      setPendingArchive(null);
    }
  }

  async function confirmHardDelete() {
    const ids = pendingHardDelete;
    if (!ids) return;
    try {
      const result = await hardDeleteClients(ids);
      if (result.blocked.length > 0) {
        toast.warning(
          `${result.deleted} deleted; ${result.blocked.length} blocked by referenced transactions. Reverse those first.`,
        );
      } else {
        toast.success(
          ids.length === 1
            ? 'Client deleted permanently.'
            : `${ids.length} clients deleted permanently.`,
        );
      }
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not delete clients.';
      toast.error(msg);
    } finally {
      setPendingHardDelete(null);
    }
  }

  return (
    <>
      <DataTable
        columns={clientColumns}
        data={data as Client[]}
        exportFilename="clients"
        initialSorting={[{ id: 'lastActivityAt', desc: true }]}
        searchPlaceholder="Search clients, industry, AM…"
        tableKey="clients.list"
        bulkActions={actions}
        bulkEntityLabel={{ singular: 'client', plural: 'clients' }}
        emptyState={{
          icon: UsersIcon,
          title: 'No clients yet',
          description: 'Add the first client to start tracking projects, invoices, and documents.',
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
              {pendingArchive?.length === 1 ? 'client' : 'clients'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archived clients are hidden from the default list but remain queryable. Their
              projects, transactions, and documents stay intact. Restore from the &quot;Show
              archived&quot; filter or via partner-only Restore.
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
              {pendingHardDelete?.length === 1 ? 'client' : 'clients'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Clients with any posted or draft transactions referencing them
              will be blocked from this delete; reverse those transactions first or archive the
              client instead.
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
