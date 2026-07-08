'use client';

import { useState } from 'react';
import { HistoryIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencyInput } from '@/components/shared/currency-input';
import { DateField } from '@/components/shared/date-field';
import { formatINR } from '@/components/shared/format-inr';
import { StatusBadge } from '@/components/shared/status-badge';

type Component = {
  id: string;
  label: string;
  kind: 'earning' | 'deduction';
  amountPaise: bigint;
  /** Optional formula reference for downstream payroll engine (we never compute). */
  formula?: string;
};

const STARTER_COMPONENTS: Component[] = [
  { id: 'basic', label: 'Basic', kind: 'earning', amountPaise: 25_000_00n },
  { id: 'hra', label: 'House Rent Allowance', kind: 'earning', amountPaise: 10_000_00n },
  { id: 'spl', label: 'Special allowance', kind: 'earning', amountPaise: 15_000_00n },
  { id: 'pf', label: 'Provident Fund (employee)', kind: 'deduction', amountPaise: 1_800_00n },
  { id: 'pt', label: 'Professional Tax', kind: 'deduction', amountPaise: 200_00n },
];

export type Props = {
  employees: readonly { id: string; fullName: string }[];
};

export function SalaryStructuresClient({ employees }: Props) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const version = 2;
  const [effectiveFrom, setEffectiveFrom] = useState('2026-04-01');
  const [components, setComponents] = useState<Component[]>(() =>
    STARTER_COMPONENTS.map((c) => ({ ...c })),
  );

  const earnings = components.filter((c) => c.kind === 'earning');
  const deductions = components.filter((c) => c.kind === 'deduction');
  const grossEarnings = earnings.reduce((s, c) => s + c.amountPaise, 0n);
  const grossDeductions = deductions.reduce((s, c) => s + c.amountPaise, 0n);
  const netPay = grossEarnings - grossDeductions;

  function patch(id: string, p: Partial<Component>) {
    setComponents((cur) => cur.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }

  function addRow(kind: 'earning' | 'deduction') {
    setComponents((cur) => [
      ...cur,
      {
        id: `${kind}-${Date.now()}`,
        label: kind === 'earning' ? 'New earning' : 'New deduction',
        kind,
        amountPaise: 0n,
      },
    ]);
  }

  function remove(id: string) {
    setComponents((cur) => cur.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3 pb-3">
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">
              Employee
            </Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="min-w-[16rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-muted-foreground text-xs tracking-wide uppercase">
              Effective from
            </Label>
            <DateField value={effectiveFrom} onChange={setEffectiveFrom} clearable={false} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <StatusBadge tone="info" label={`v${version} (draft)`} dot={false} />
            <Button variant="outline" size="sm" disabled title="Version history — coming soon.">
              <HistoryIcon className="mr-1.5 size-3.5" aria-hidden />
              History
            </Button>
            <Button size="sm" disabled title="Saving salary structures — coming soon.">
              Save as v{version + 1}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Earnings</CardTitle>
          <Button variant="outline" size="sm" onClick={() => addRow('earning')}>
            <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
            Add earning
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {earnings.map((c) => (
            <ComponentRow
              key={c.id}
              component={c}
              onPatch={(p) => patch(c.id, p)}
              onRemove={() => remove(c.id)}
            />
          ))}
          <Subtotal label="Gross earnings" amount={grossEarnings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Deductions</CardTitle>
          <Button variant="outline" size="sm" onClick={() => addRow('deduction')}>
            <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
            Add deduction
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {deductions.map((c) => (
            <ComponentRow
              key={c.id}
              component={c}
              onPatch={(p) => patch(c.id, p)}
              onRemove={() => remove(c.id)}
            />
          ))}
          <Subtotal label="Total deductions" amount={grossDeductions} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <Label className="text-muted-foreground text-xs tracking-wide uppercase">
            Net pay (computed by payroll engine, displayed here for reference)
          </Label>
          <span className="font-mono text-xl font-semibold tabular-nums">{formatINR(netPay)}</span>
        </CardContent>
      </Card>
    </div>
  );
}

function ComponentRow({
  component,
  onPatch,
  onRemove,
}: {
  component: Component;
  onPatch: (p: Partial<Component>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 rounded-md border p-2">
      <Input
        className="col-span-6"
        value={component.label}
        onChange={(e) => onPatch({ label: e.target.value })}
      />
      <Input
        className="col-span-3"
        placeholder="Formula (optional)"
        value={component.formula ?? ''}
        onChange={(e) => onPatch({ formula: e.target.value })}
      />
      <div className="col-span-2">
        <CurrencyInput
          value={component.amountPaise}
          onValueChange={(p) => onPatch({ amountPaise: p ?? 0n })}
        />
      </div>
      <div className="col-span-1 text-right">
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove component">
          <Trash2Icon className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Subtotal({ label, amount }: { label: string; amount: bigint }) {
  return (
    <div className="flex items-center justify-between border-t pt-2 text-sm">
      <Label className="text-muted-foreground">{label}</Label>
      <span className="font-mono tabular-nums">{formatINR(amount)}</span>
    </div>
  );
}
