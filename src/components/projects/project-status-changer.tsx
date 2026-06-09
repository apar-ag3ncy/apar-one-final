'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { setProjectStatus } from '@/lib/server-stub/entity-actions';
import { PROJECT_DB_STATUS_LABELS, type ProjectDbStatus } from '@/components/projects/types';

const ORDER: readonly ProjectDbStatus[] = [
  'pitch',
  'won',
  'active',
  'on_hold',
  'completed',
  'cancelled',
];

export function ProjectStatusChanger({
  projectId,
  value,
  onChanged,
}: {
  projectId: string;
  value: ProjectDbStatus;
  /**
   * Called after a successful status change. In the OS shell the window is
   * mounted outside the RSC route tree, so `router.refresh()` is a no-op —
   * callers pass this to re-run their own data fetch.
   */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    const nextStatus = next as ProjectDbStatus;
    if (nextStatus === value) return;
    startTransition(async () => {
      try {
        await setProjectStatus(projectId, nextStatus);
        toast.success(`Status set to ${PROJECT_DB_STATUS_LABELS[nextStatus]}`);
        router.refresh();
        onChanged?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not update status';
        toast.error(message);
      }
    });
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger size="sm" aria-label="Project status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ORDER.map((s) => (
          <SelectItem key={s} value={s}>
            {PROJECT_DB_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
