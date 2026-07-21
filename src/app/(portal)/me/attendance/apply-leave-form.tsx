'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyMyLeave } from '@/lib/server/portal/leave-actions';

/**
 * Apply for leave.
 *
 * The kind list is the REAL `leave_kind` enum. The old portal mock offered
 * "bereavement" and "lop", neither of which exists in the database — wiring
 * that form up would have thrown a zod error on every submit.
 */
const KINDS = [
  { value: 'casual', label: 'Casual' },
  { value: 'sick', label: 'Sick' },
  { value: 'earned', label: 'Earned' },
  { value: 'comp_off', label: 'Comp-off' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'paternity', label: 'Paternity' },
];

function daysBetween(from: string, to: string): string {
  if (!from || !to || to < from) return '';
  const n =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return String(n);
}

export function ApplyLeaveForm() {
  const router = useRouter();
  const [kind, setKind] = useState('casual');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [days, setDays] = useState('');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();

  // Keep `days` in step with the range, but let the user override it for
  // half-days (the column allows one decimal).
  function syncDates(nextFrom: string, nextTo: string) {
    setFromDate(nextFrom);
    setToDate(nextTo);
    const auto = daysBetween(nextFrom, nextTo);
    if (auto) setDays(auto);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await applyMyLeave({ kind, fromDate, toDate, days, notes });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Leave applied. Your manager will see it in their queue.');
      setFromDate('');
      setToDate('');
      setDays('');
      setNotes('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="kind">Type</Label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          disabled={isPending}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="days">Days</Label>
        <Input
          id="days"
          inputMode="decimal"
          placeholder="1"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fromDate">From</Label>
        <Input
          id="fromDate"
          type="date"
          value={fromDate}
          onChange={(e) => syncDates(e.target.value, toDate)}
          disabled={isPending}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="toDate">To</Label>
        <Input
          id="toDate"
          type="date"
          value={toDate}
          onChange={(e) => syncDates(fromDate, e.target.value)}
          disabled={isPending}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="notes">Reason (optional)</Label>
        <Input
          id="notes"
          placeholder="Anything your manager should know"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending || !fromDate || !toDate}>
          {isPending ? 'Applying…' : 'Apply for leave'}
        </Button>
      </div>
    </form>
  );
}
