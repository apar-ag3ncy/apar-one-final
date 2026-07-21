'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cancelMyLeave, decideTeamLeave } from '@/lib/server/portal/leave-actions';

/** Withdraw one of my own pending applications. */
export function WithdrawLeaveButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelMyLeave({ id });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success('Request withdrawn.');
          router.refresh();
        })
      }
    >
      {isPending ? 'Withdrawing…' : 'Withdraw'}
    </Button>
  );
}

/**
 * Manager decision on a report's request: approve or reject, with a reply and
 * — on approval — whether it is paid.
 */
export function DecideLeaveControls({
  id,
  countsAgainstAllowance,
}: {
  id: string;
  countsAgainstAllowance: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [isPaid, setIsPaid] = useState(countsAgainstAllowance);
  const [isPending, startTransition] = useTransition();

  function decide(accept: boolean) {
    startTransition(async () => {
      const res = await decideTeamLeave({
        id,
        accept,
        managerNote: note,
        isPaid: accept ? isPaid : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(accept ? 'Leave approved.' : 'Leave rejected.');
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <Input
        placeholder="Reply to your teammate (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={isPending}
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={isPaid}
            onChange={(e) => setIsPaid(e.target.checked)}
            disabled={isPending}
          />
          Approve as paid
        </label>
        <Button
          type="button"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={isPending}
          onClick={() => decide(true)}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-3 text-xs"
          disabled={isPending}
          onClick={() => decide(false)}
        >
          Reject
        </Button>
      </div>
      {isPaid && countsAgainstAllowance ? (
        <p className="text-muted-foreground text-[11px]">
          Counts against the monthly paid-leave allowance.
        </p>
      ) : null}
    </div>
  );
}
