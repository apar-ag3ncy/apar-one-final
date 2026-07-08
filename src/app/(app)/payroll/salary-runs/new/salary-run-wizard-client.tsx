'use client';

import { useState } from 'react';
import { toast } from 'sonner';

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
import { DateField } from '@/components/shared/date-field';
import { formatINR } from '@/components/shared/format-inr';
import { previewSalaryFromAttendance } from '@/lib/server/entities/salary-attendance';

type LineState = {
  employeeId: string;
  fullName: string;
  earningsPaise: bigint;
  deductionsPaise: bigint;
  /** Net pay = earnings − deductions, captured (never re-computed). */
  netPaise: bigint;
  // Attendance context, filled by "Prorate from attendance" (display-only).
  monthlyGrossPaise?: bigint;
  workingDays?: number;
  lopDays?: number;
  payableDays?: number;
  hasStructure?: boolean;
};

type Values = {
  month: string;
  payDate: string;
  paymentSource: '1100' | '1110' | '';
  lines: LineState[];
};

const MONTH_RE = /^\d{4}-\d{2}$/;

export function SalaryRunWizardClient({
  employees,
}: {
  employees: readonly { id: string; fullName: string }[];
}) {
  const [prorating, setProrating] = useState(false);
  const [periodMeta, setPeriodMeta] = useState<{
    workingDays: number;
    holidayCount: number;
  } | null>(null);

  const initialValues: Values = {
    month: new Date().toISOString().slice(0, 7),
    payDate: '',
    paymentSource: '',
    lines: employees.map((e) => ({
      employeeId: e.id,
      fullName: e.fullName,
      earningsPaise: 0n,
      deductionsPaise: 0n,
      netPaise: 0n,
    })),
  };

  async function prorate(
    month: string,
    currentLines: LineState[],
    onPatch: (p: Partial<Values>) => void,
  ) {
    if (!MONTH_RE.test(month)) {
      toast.error('Pick a month on the Period step first.');
      return;
    }
    setProrating(true);
    try {
      const preview = await previewSalaryFromAttendance(month);
      setPeriodMeta({ workingDays: preview.daysInMonth, holidayCount: preview.holidayCount });
      // Merge by employee: update each roster row that the (active-only) preview
      // covers with its prorated earnings + attendance context, and leave any
      // other row (and any manual edits) untouched. Never drop rows.
      const byId = new Map(preview.lines.map((l) => [l.employeeId, l] as const));
      onPatch({
        lines: currentLines.map((line) => {
          const p = byId.get(line.employeeId);
          if (!p) return line;
          return {
            ...line,
            earningsPaise: p.proratedGrossPaise,
            netPaise: p.proratedGrossPaise - line.deductionsPaise,
            monthlyGrossPaise: p.monthlyGrossPaise,
            workingDays: p.daysInMonth,
            lopDays: p.lopDays,
            payableDays: p.payableDays,
            hasStructure: p.hasStructure,
          };
        }),
      });
      toast.success(
        `Prorated ${preview.lines.length} employees for ${month} — ${preview.daysInMonth} days in the month` +
          (preview.holidayCount
            ? `, ${preview.holidayCount} holiday${preview.holidayCount === 1 ? '' : 's'}.`
            : '.'),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prorate from attendance.');
    } finally {
      setProrating(false);
    }
  }

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
            <DateField
              value={values.payDate}
              onChange={(next) => onPatch({ payDate: next })}
              clearable={false}
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
      description: 'Per-employee earnings + deductions, prorated by attendance',
      render: ({ values, onPatch }) => {
        const totalGross = values.lines.reduce((s, l) => s + l.earningsPaise, 0n);
        const totalNet = values.lines.reduce((s, l) => s + l.netPaise, 0n);
        const patchLine = (idx: number, p: Partial<LineState>) => {
          const next = values.lines.slice();
          next[idx] = { ...next[idx]!, ...p };
          onPatch({ lines: next });
        };
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Earnings prorate each employee&apos;s monthly gross by attendance for{' '}
                <span className="font-medium">{values.month || 'the selected month'}</span> (working
                days − absent days). Override any cell — net recalculates.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void prorate(values.month, values.lines, onPatch)}
                disabled={prorating || !values.month}
              >
                {prorating ? 'Prorating…' : 'Prorate from attendance'}
              </Button>
            </div>
            {periodMeta ? (
              <p className="text-muted-foreground text-xs">
                {periodMeta.workingDays} days in the month
                {periodMeta.holidayCount
                  ? ` · ${periodMeta.holidayCount} company holiday${periodMeta.holidayCount === 1 ? '' : 's'}`
                  : ''}{' '}
                this month. Absent days reduce pay; leave, WFH, half-days and weekly-offs are paid.
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Payable / working</TableHead>
                  <TableHead className="text-right">Earnings</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net pay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {values.lines.map((line, idx) => (
                  <TableRow key={line.employeeId}>
                    <TableCell className="font-medium">
                      {line.fullName}
                      {line.hasStructure === false ? (
                        <span className="text-muted-foreground ml-1.5 text-xs">(no structure)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {line.payableDays != null && line.workingDays != null ? (
                        <>
                          {line.payableDays}/{line.workingDays}
                          {line.lopDays ? (
                            <span className="text-destructive"> · {line.lopDays} LOP</span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
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
                  <TableCell colSpan={2}>Totals</TableCell>
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
        );
      },
    },
    {
      id: 'review',
      title: 'Review',
      description: 'Final check; posting writes one transaction per employee + a clearing JV',
      render: ({ values }) => {
        const totalGross = values.lines.reduce((s, l) => s + l.earningsPaise, 0n);
        const totalNet = values.lines.reduce((s, l) => s + l.netPaise, 0n);
        return (
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
        );
      },
    },
  ];

  async function handleSubmit(_values: Values) {
    void _values;
    // TODO(backend): call postSalaryRun(values) once the run-posting action ships.
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
      initialValues={initialValues}
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
