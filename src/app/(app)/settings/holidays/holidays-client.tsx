'use client';

import { useState, useTransition } from 'react';
import { CalendarOffIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { DateField } from '@/components/shared/date-field';
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  type HolidayRow,
} from '@/lib/server/entities/holidays';

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function HolidaysClient({ initial }: { initial: readonly HolidayRow[] }) {
  const [rows, setRows] = useState<readonly HolidayRow[]>(initial);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function refresh() {
    try {
      const next = await listHolidays();
      startTransition(() => setRows(next));
    } catch {
      /* keep the current list; the mutation toast already reported status */
    }
  }

  async function add() {
    if (!date) {
      toast.error('Pick a date.');
      return;
    }
    if (!name.trim()) {
      toast.error('Enter a name.');
      return;
    }
    setBusy(true);
    try {
      const res = await createHoliday({ date, name: name.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDate('');
      setName('');
      await refresh();
      toast.success('Holiday added.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: HolidayRow) {
    setBusy(true);
    try {
      const res = await deleteHoliday(row.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await refresh();
      toast.success('Holiday removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a holiday</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hol-date" className="text-muted-foreground text-xs">
                Date
              </Label>
              <DateField
                id="hol-date"
                value={date}
                onChange={setDate}
                clearable={false}
                className="w-44"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="hol-name" className="text-muted-foreground text-xs">
                Name
              </Label>
              <Input
                id="hol-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Diwali"
                maxLength={120}
              />
            </div>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Holidays{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={CalendarOffIcon}
              title="No holidays yet"
              description="Add the year's public and company holidays so payroll can exclude them from working days."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-4 tabular-nums">{prettyDate(r.date)}</TableCell>
                    <TableCell className="px-4 font-medium">{r.name}</TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(r)}
                        disabled={busy}
                        aria-label={`Remove ${r.name}`}
                      >
                        <Trash2Icon className="text-destructive size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
