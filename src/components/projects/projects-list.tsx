'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveIcon, FolderKanbanIcon, Trash2Icon } from 'lucide-react';
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
import { archiveProjects, hardDeleteProjects } from '@/lib/server/entities/projects';
import { projectColumns } from './columns';
import type { Project } from './types';

export type ProjectsListProps = {
  data: readonly Project[];
  canArchive?: boolean;
  canHardDelete?: boolean;
};

export function ProjectsList({
  data,
  canArchive = false,
  canHardDelete = false,
}: ProjectsListProps) {
  const router = useRouter();
  const [pendingArchive, setPendingArchive] = useState<readonly string[] | null>(null);
  const [pendingHardDelete, setPendingHardDelete] = useState<readonly string[] | null>(null);

  const actions: ActionBarAction<Project>[] = [
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
      await archiveProjects(ids);
      toast.success(ids.length === 1 ? 'Project archived.' : `${ids.length} projects archived.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive projects.');
    } finally {
      setPendingArchive(null);
    }
  }

  async function confirmHardDelete() {
    const ids = pendingHardDelete;
    if (!ids) return;
    try {
      const result = await hardDeleteProjects(ids);
      if (result.blocked.length > 0) {
        toast.warning(
          `${result.deleted} deleted; ${result.blocked.length} blocked by referenced transactions. Reverse those first.`,
        );
      } else {
        toast.success(
          ids.length === 1
            ? 'Project deleted permanently.'
            : `${ids.length} projects deleted permanently.`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete projects.');
    } finally {
      setPendingHardDelete(null);
    }
  }

  return (
    <>
      <DataTable
        columns={projectColumns}
        data={data as Project[]}
        exportFilename="projects"
        initialSorting={[{ id: 'startedAt', desc: true }]}
        searchPlaceholder="Search projects, code, client, lead…"
        tableKey="projects.list"
        bulkActions={actions}
        bulkEntityLabel={{ singular: 'project', plural: 'projects' }}
        emptyState={{
          icon: FolderKanbanIcon,
          title: 'No projects yet',
          description:
            'Create a project under a client to start tracking deliverables and milestones.',
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
              {pendingArchive?.length === 1 ? 'project' : 'projects'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archived projects are hidden from the default list but remain queryable. Deliverables,
              milestones, and ledger references stay intact.
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
              {pendingHardDelete?.length === 1 ? 'project' : 'projects'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Projects with non-reversed transactions will be blocked from
              this delete.
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
