import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { getEmployeeKpis } from '@/lib/server/entities/employee-kpis';
import { effectiveProbationEnd, probationDaysLeft } from '@/lib/employee-badges';
import { getMyCompensation, getMyDetails, getMyLedger } from '@/lib/server/portal/me';
import { requirePortalEmployee } from '@/lib/server/portal/session';

export const metadata: Metadata = { title: 'Apar · My profile' };

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Intern',
  consultant: 'Consultant',
};

export default async function MyProfilePage() {
  const me = await requirePortalEmployee();
  // All four are self-scoped; getEmployeeKpis is the one existing read that is
  // safe to reuse (no money, no capability gate) — and it gets the id from the
  // session, never from the request.
  const [details, comp, ledger, kpis] = await Promise.all([
    getMyDetails(),
    getMyCompensation(),
    getMyLedger(),
    getEmployeeKpis({ employeeId: me.employeeId }),
  ]);

  const probationInput = {
    joinedOn: details.joinedOn,
    employmentType: details.employmentType,
    probationEndsOn: details.probationEndsOn,
    confirmedOn: details.confirmedOn,
  };
  const probationEnd = effectiveProbationEnd(probationInput);
  const daysLeft = probationEnd ? probationDaysLeft(probationInput) : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {details.displayName ?? details.fullName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {details.designation ?? 'Team member'}
          {details.department ? ` · ${details.department}` : ''} · {details.employeeCode}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge
            tone={details.status === 'active' ? 'success' : 'neutral'}
            label={details.status === 'active' ? 'Active' : details.status}
            dot={false}
          />
          {details.portalRole === 'manager' ? (
            <StatusBadge tone="info" label="Manager" dot={false} />
          ) : null}
          {daysLeft !== null && daysLeft > 0 ? (
            <StatusBadge tone="warning" label={`Probation · ${daysLeft}d left`} dot={false} />
          ) : null}
        </div>
      </header>

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label={`Attendance · ${kpis.month}`}
          value={kpis.attendance.attendancePct === null ? '—' : `${kpis.attendance.attendancePct}%`}
          hint={`${kpis.attendance.presentDays} present · ${kpis.attendance.onLeaveDays} on leave`}
        />
        <Kpi
          label="Deliverables"
          value={`${kpis.deliverables.completed}/${kpis.deliverables.assigned}`}
          hint={
            kpis.deliverables.completionPct === null
              ? 'Nothing assigned yet'
              : `${kpis.deliverables.completionPct}% completed`
          }
        />
        <Kpi
          label="Paid this FY"
          value={formatINR(comp.paidThisFyPaise, { showFraction: false })}
          hint={`Since ${fmtDate(comp.fyStart)}`}
        />
      </section>

      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Employment type" value={EMPLOYMENT_LABEL[details.employmentType] ?? details.employmentType} />
            <Detail label="Joined on" value={fmtDate(details.joinedOn)} />
            <Detail label="Date of birth" value={fmtDate(details.dateOfBirth)} />
            <Detail label="Reports to" value={details.reportsToName ?? '—'} />
            <Detail label="Work email" value={details.workEmail ?? '—'} />
            <Detail label="Phone" value={details.phone ?? '—'} />
            {probationEnd ? <Detail label="Probation ends" value={fmtDate(probationEnd)} /> : null}
            {details.confirmedOn ? (
              <Detail label="Confirmed on" value={fmtDate(details.confirmedOn)} />
            ) : null}
          </dl>
          <p className="text-muted-foreground mt-4 text-xs">
            Something out of date? Ask your admin to update it.
          </p>
        </CardContent>
      </Card>

      {/* Compensation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compensation</CardTitle>
        </CardHeader>
        <CardContent>
          {comp.current ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Detail
                label="Monthly CTC"
                value={formatINR(comp.current.ctcMonthlyPaise)}
                mono
              />
              <Detail label="Effective from" value={fmtDate(comp.current.effectiveFrom)} />
              <Detail label="Basic" value={formatINR(comp.current.basicPaise)} mono />
              <Detail label="HRA" value={formatINR(comp.current.hraPaise)} mono />
              {details.payrollGrade ? (
                <Detail label="Payroll grade" value={details.payrollGrade} />
              ) : null}
              {comp.lastPayment ? (
                <Detail
                  label="Last paid"
                  value={`${formatINR(comp.lastPayment.amountPaise)} · ${fmtDate(comp.lastPayment.paidOn)}`}
                  mono
                />
              ) : null}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              No salary structure on record yet. Your admin sets this up.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing paid out yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {ledger.map((line) => (
                <li
                  key={`${line.kind}-${line.id}`}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{line.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {fmtDate(line.date)}
                      {line.method ? ` · ${line.method}` : ''}
                      {line.kind === 'bonus' ? ' · Bonus' : ''}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap">
                    {formatINR(line.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
        <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono tabular-nums' : 'mt-0.5'}>{value}</dd>
    </div>
  );
}
