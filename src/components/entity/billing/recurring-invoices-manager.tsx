'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { PlayIcon, PlusIcon, RepeatIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { rupeesToPaise } from '@/lib/money';
import {
  createRecurringSchedule,
  deleteRecurringSchedule,
  generateDueRecurringInvoices,
  listRecurringSchedules,
  setRecurringScheduleActive,
} from '@/lib/server/billing/recurring';
import type { RecurringInvoiceSchedule } from '@/lib/db/schema';
import type { CompanyBankAccountOption } from '@/lib/server/settings/company';
import type { InvoiceThemeSummary } from '@/lib/server/billing/invoice-themes';

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecurringInvoicesManager({
  open,
  onOpenChange,
  clientId,
  clientName,
  bankAccounts,
  themes,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  bankAccounts: readonly CompanyBankAccountOption[];
  themes: readonly InvoiceThemeSummary[];
  onGenerated: () => void;
}) {
  const [rows, setRows] = useState<RecurringInvoiceSchedule[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const reload = useCallback(() => {
    listRecurringSchedules(clientId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [clientId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  function generateDue() {
    startTransition(async () => {
      const res = await generateDueRecurringInvoices();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { generated, failed } = res.data;
      if (generated === 0 && failed === 0) toast.info('No invoices are due right now.');
      else
        toast.success(
          `Generated ${generated} invoice${generated === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`,
        );
      reload();
      onGenerated();
    });
  }

  function toggleActive(s: RecurringInvoiceSchedule) {
    startTransition(async () => {
      const res = await setRecurringScheduleActive(s.id, !s.isActive);
      if (!res.ok) toast.error(res.message);
      else reload();
    });
  }

  function remove(s: RecurringInvoiceSchedule) {
    startTransition(async () => {
      const res = await deleteRecurringSchedule(s.id);
      if (!res.ok) toast.error(res.message);
      else {
        toast.success('Schedule removed.');
        reload();
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Recurring invoices — {clientName}</DialogTitle>
            <DialogDescription>
              Retainer templates that generate a draft invoice each period. Click “Generate due” to
              create the invoices that are due; review and send them as usual.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={generateDue} disabled={pending}>
              <PlayIcon className="mr-1.5 size-3.5" aria-hidden />
              Generate due
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
              New schedule
            </Button>
          </div>

          {rows === null ? (
            <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No recurring schedules yet. Create one to bill {clientName} automatically each period.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.isActive ? (
                        <StatusBadge tone="success" label="Active" dot={false} />
                      ) : (
                        <StatusBadge tone="neutral" label="Paused" dot={false} />
                      )}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {CADENCE_LABEL[s.cadence] ?? s.cadence}
                      {s.intervalCount > 1 ? ` ×${s.intervalCount}` : ''} ·{' '}
                      {formatINR(BigInt(s.template.capturedTotalPaise || '0'))} · next {s.nextRunDate}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(s)} disabled={pending}>
                      {s.isActive ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(s)}
                      disabled={pending}
                      aria-label="Remove schedule"
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        clientId={clientId}
        bankAccounts={bankAccounts}
        themes={themes}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */

type LineRow = { description: string; amount: string; taxPct: string };

function ScheduleFormDialog({
  open,
  onOpenChange,
  clientId,
  bankAccounts,
  themes,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  bankAccounts: readonly CompanyBankAccountOption[];
  themes: readonly InvoiceThemeSummary[];
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'weekly' | 'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [dueDays, setDueDays] = useState('0');
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [bankAccountId, setBankAccountId] = useState('__none__');
  const [themeId, setThemeId] = useState('__none__');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ description: '', amount: '', taxPct: '18' }]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setName('');
      setCadence('monthly');
      setStartDate(todayISO());
      setEndDate('');
      setDueDays('0');
      setPlaceOfSupply('');
      setBankAccountId('__none__');
      setThemeId('__none__');
      setTerms('');
      setLines([{ description: '', amount: '', taxPct: '18' }]);
    });
  }, [open]);

  function setLine(i: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function save() {
    if (name.trim() === '') {
      toast.error('Name the schedule (e.g. “Monthly retainer”).');
      return;
    }
    let parsed: Array<{ description: string; amountPaise: bigint; taxRateBps: number }>;
    try {
      parsed = lines.map((l, i) => {
        if (l.description.trim() === '') throw new Error(`Line ${i + 1}: description required.`);
        const amt = rupeesToPaise(l.amount.replace(/[,\s]/g, '').trim() || '0');
        if (amt <= 0n) throw new Error(`Line ${i + 1}: amount must be positive.`);
        const pct = Number(l.taxPct || '0');
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error(`Line ${i + 1}: bad tax %.`);
        return { description: l.description.trim(), amountPaise: amt, taxRateBps: Math.round(pct * 100) };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid line.');
      return;
    }
    startTransition(async () => {
      const res = await createRecurringSchedule({
        clientId,
        name: name.trim(),
        cadence,
        intervalCount: 1,
        startDate,
        endDate: endDate || null,
        dueDays: Number(dueDays || '0'),
        placeOfSupply: placeOfSupply.trim() || null,
        bankAccountId: bankAccountId === '__none__' ? null : bankAccountId,
        themeId: themeId === '__none__' ? null : themeId,
        terms: terms.trim() || null,
        lines: parsed,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success('Recurring schedule created.');
      onSaved();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New recurring schedule</DialogTitle>
          <DialogDescription>
            <RepeatIcon className="mr-1 inline size-3.5" aria-hidden />
            Captured-not-computed: the amounts you enter are stored and re-billed each period.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rc-name">Name</Label>
            <Input
              id="rc-name"
              placeholder="Monthly retainer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rc-cadence">Cadence</Label>
              <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
                <SelectTrigger id="rc-cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-due">Payment due (days)</Label>
              <Input
                id="rc-due"
                inputMode="numeric"
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rc-start">First invoice date</Label>
              <Input
                id="rc-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-end">End date (optional)</Label>
              <Input
                id="rc-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rc-pos">Place of supply</Label>
              <Input
                id="rc-pos"
                placeholder="27"
                maxLength={2}
                value={placeOfSupply}
                onChange={(e) => setPlaceOfSupply(e.target.value.replace(/\D/g, '').slice(0, 2))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-bank">Bank account</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger id="rc-bank">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Default</SelectItem>
                  {bankAccounts.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-theme">Theme</Label>
              <Select value={themeId} onValueChange={setThemeId}>
                <SelectTrigger id="rc-theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Default</SelectItem>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Line items</Label>
            <div className="flex flex-col gap-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_64px_32px] items-center gap-2">
                  <Input
                    placeholder="Retainer — monthly services"
                    value={l.description}
                    onChange={(e) => setLine(i, { description: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder="₹"
                    value={l.amount}
                    onChange={(e) => setLine(i, { amount: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder="GST%"
                    value={l.taxPct}
                    onChange={(e) => setLine(i, { taxPct: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setLines((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)))}
                    disabled={lines.length <= 1}
                    aria-label="Remove line"
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => setLines((p) => [...p, { description: '', amount: '', taxPct: '18' }])}
              >
                Add line
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="rc-terms">Terms (optional)</Label>
            <Textarea id="rc-terms" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
