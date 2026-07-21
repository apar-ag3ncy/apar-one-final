'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { updateMyTaskStatus } from '@/lib/server/portal/tasks-actions';

const OPTIONS = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'little_delayed', label: 'Slightly delayed' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'done', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

/**
 * Status control for one of the employee's own deliverables.
 *
 * The server action re-checks ownership in the UPDATE's WHERE clause, so this
 * is a convenience control, not the security boundary.
 */
export function TaskStatusSelect({
  taskId,
  status,
}: {
  taskId: string;
  status: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    const previous = value;
    setValue(next); // optimistic
    startTransition(async () => {
      const res = await updateMyTaskStatus({
        taskId,
        status: next as (typeof OPTIONS)[number]['value'],
      });
      if (!res.ok) {
        setValue(previous); // roll back
        toast.error(res.error);
        return;
      }
      toast.success('Status updated.');
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Task status"
      value={value}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value)}
      className="border-input bg-background h-8 rounded-md border px-2 text-xs disabled:opacity-60"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
