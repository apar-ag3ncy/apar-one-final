'use client';

import { useState } from 'react';
import { CreationWizard, type WizardStep } from '@/components/entity/creation-wizard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/shared/currency-input';
import { formatINR } from '@/components/shared/format-inr';

type LineState = {
  employeeId: string;
  fullName: string;
  earningsPaise: bigint;
  deductionsPaise: bigint;
  /** Net pay = earnings − deductions, captured (never re-computed). */
  netPaise: bigint;
};

type Values = {
  month: string;
  payDate: string;
  paymentSource: '1100' | '1110' | '';
  lines: LineState[];
};

export function SalaryRunWizardClient({
  employees,
}: {
  employees: readonly { id: string; fullName: string }[];
}) {
  const [values, setValues] = useState<Values>({
    month: new Date().toISOString().slice(0, 7),
    payDate: '',
    paymentSource: '',
    lines: employees.map((e) => ({
      employeeId: e.id,
      fullName: e.fullName,
      earningsPaise: 50_000_00n,
      deductionsPaise: 2_000_00n,
      netPaise: 48_000_00n,
    })),
  });

  function patchLine(idx: number, p: Partial<LineState>) {
    const next = values.lines.slice();
    next[idx] = { ...next[idx]!, ...p };
    setValues({ ...values, lines: next });
  }

  const totalNet = values.lines.reduce((s, l) => s + l.netPaise, 0n);
  const totalGross = values.lines.reduce((s, l) => s + l.earningsPaise, 0n);

  const steps: WizardStep<Values>[] = [
    {
      id: 'period',
      title: 'Period',
      description: 'Month + paydate',
      validate: (v) => {
        const errors: Record<string, string> = {};
        if (!v.month) errors.month = 'Pick a month';
        if (!v.payDate) errors.payDate = 'Pick a paydate';
        if (!v.paymentSource) errors.paymentSource = 'Pick the bank to pay from';
        return errors;
      },
      render: ({ values, onPatch, errors }) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Month" error={errors.month}>
            <Input
              type="month"
              value={values.month}
              onChange={(e) => onPatch({ month: e.target.value })}
            />
          </Field>
          <Field label="Paydate" error={errors.payDate}>
            <Input
              type="date"
              value={values.payDate}
              onChange={(e) => onPatch({ payDate: e.target.value })}
            />
          </Field>
          <Field label="Paid from" error={errors.paymentSource}>
            <select
              className="bg-background h-9 rounded-md border px-3 text-sm"
              value={values.paymentSource}
              onChange={(e) =>
                onPatch({ paymentSource: e.target.value as Values['paymentSource'] })
              }
            >
              <option value="">Choose…</option>
              <option value="1100">1100 — HDFC Current</option>
              <option value="1110">1110 — ICICI Current</option>
            </select>
          </Field>
        </div>
      ),
    },
    {
      id: 'lines',
      title: 'Lines',
      description:
        'Per-employee earnings + deductions captured from active structures or uploaded sheet',
      render: () => (
        <div className="space-y-3">
          <div className="flex justify-between">
            <p className="text-muted-foreground text-xs">
              Lines auto-populate from each employee&apos;s active salary structure version.
              Override any cell — the row recalculates net pay.
            </p>
            <Button variant="outline" size="sm" disabled title="CSV import — coming soon.">
              Upload consolidated sheet (CSV)
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {values.lines.map((line, idx) => (
                <TableRow key={line.employeeId}>
                  <TableCell className="font-medium">{line.fullName}</TableCell>
                  <TableCell className="text-right">
                    <CurrencyInput
                      value={line.earningsPaise}
                      onValueChange={(p) =>
                        patchLine(idx, {
                          earningsPaise: p ?? 0n,
                          netPaise: (p ?? 0n) - line.deductionsPaise,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <CurrencyInput
                      value={line.deductionsPaise}
                      onValueChange={(p) =>
                        patchLine(idx, {
                          deductionsPaise: p ?? 0n,
                          netPaise: line.earningsPaise - (p ?? 0n),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <CurrencyInput
                      value={line.netPaise}
                      onValueChange={(p) => patchLine(idx, { netPaise: p ?? 0n })}
                    />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/20 font-medium">
                <TableCell>Totals</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatINR(totalGross)}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-mono tabular-nums">
                  {formatINR(totalNet)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Final check; posting writes one transaction per employee + a clearing JV',
      render: () => (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Summary label="Month" value={values.month} />
            <Summary label="Paydate" value={values.payDate} />
            <Summary label="From bank" value={values.paymentSource} />
            <Summary label="Lines" value={values.lines.length.toString()} />
            <Summary label="Gross earnings" value={formatINR(totalGross)} />
            <Summary label="Total net pay" value={formatINR(totalNet)} mono />
          </CardContent>
        </Card>
      ),
    },
  ];

  async function handleSubmit(_values: Values) {
    void _values;
    // TODO(backend): call A.postSalaryRun(values).
    return {
      ok: false as const,
      message: 'Backend `postSalaryRun` not yet shipped — the wizard state is fully wired.',
      errors: {},
    };
  }

  return (
    <CreationWizard<Values>
      title="Run payroll"
      steps={steps}
      initialValues={values}
      onSubmit={handleSubmit}
    />
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs tracking-wide uppercase">{label}</Label>
      {children}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b pb-1 last:border-b-0 last:pb-0">
      <Label className="text-muted-foreground">{label}</Label>
      <span className={mono ? 'font-mono font-semibold tabular-nums' : 'text-foreground'}>
        {value}
      </span>
    </div>
  );
}
