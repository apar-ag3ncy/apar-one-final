import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { getEmployeeKpis } from '@/lib/server/entities/employee-kpis';
import {
  effectivePaid,
  getMyLeaves,
  getMyPaidLeaveAllowance,
  getTeamLeaveQueue,
} from '@/lib/server/portal/leave';
import { requirePortalEmployee } from '@/lib/server/portal/session';

import { ApplyLeaveForm } from './apply-leave-form';
import { DecideLeaveControls, WithdrawLeaveButton } from './leave-actions-client';

export const metadata: Metadata = { title: 'Apar · Attendance & leave' };

const KIND_LABEL: Record<string, string> = {
  earned: 'Earned',
  casual: 'Casual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  comp_off: 'Comp-off',
  maternity: 'Maternity',
  paternity: 'Paternity',
};

const STATUS_TONE: Record<string, StatusTone> = {
  applied: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  applied: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function range(from: string, to: string): string {
  return from === to ? fmt(from) : `${fmt(from)} → ${fmt(to)}`;
}

export default async function AttendancePage() {
  const me = await requirePortalEmployee();
  const [kpis, leaves, allowance, queue] = await Promise.all([
    getEmployeeKpis({ employeeId: me.employeeId }),
    getMyLeaves(),
    getMyPaidLeaveAllowance(),
    // Only managers have a queue; members get an empty list without a query.
    me.isManager ? getTeamLeaveQueue() : Promise.resolve([]),
  ]);

  const allowanceLeft = Math.max(0, allowance.perMonth - allowance.usedThisMonth);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance &amp; leave</h1>
        <p className="text-muted-foreground text-sm">
          Apply for leave and track your manager&rsquo;s decision.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={`Attendance · ${kpis.month}`}
          value={kpis.attendance.attendancePct === null ? '—' : `${kpis.attendance.attendancePct}%`}
          hint={`${kpis.attendance.presentDays} present · ${kpis.attendance.absentDays} absent`}
        />
        <Stat
          label="On leave this month"
          value={String(kpis.attendance.onLeaveDays)}
          hint="Days recorded as leave"
        />
        <Stat
          label="Paid leave left"
          value={`${allowanceLeft} of ${allowance.perMonth}`}
          hint="This calendar month"
        />
      </section>

      {/* Manager queue first — it is someone else's request waiting on you. */}
      {me.isManager ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Requests to review{queue.length > 0 ? ` (${queue.length})` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing pending from your team right now.
              </p>
            ) : (
              <ul className="divide-y">
                {queue.map((req) => (
                  <li key={req.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {req.employeeName}{' '}
                          <span className="text-muted-foreground font-normal">
                            · {req.employeeCode}
                          </span>
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {KIND_LABEL[req.kind] ?? req.kind} · {req.days} day
                          {req.days === '1' ? '' : 's'} · {range(req.fromDate, req.toDate)}
                        </p>
                        {req.notes ? <p className="mt-1 text-sm">“{req.notes}”</p> : null}
                      </div>
                    </div>
                    <DecideLeaveControls
                      id={req.id}
                      countsAgainstAllowance={req.countsAgainstAllowance}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply for leave</CardTitle>
        </CardHeader>
        <CardContent>
          <ApplyLeaveForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My leave</CardTitle>
        </CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-muted-foreground text-sm">You haven&rsquo;t applied for leave yet.</p>
          ) : (
            <ul className="divide-y">
              {leaves.map((l) => {
                const paid = effectivePaid(l.kind, l.isPaid);
                return (
                  <li key={l.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm">
                          {KIND_LABEL[l.kind] ?? l.kind} · {l.days} day{l.days === '1' ? '' : 's'}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {range(l.fromDate, l.toDate)}
                        </p>
                        {l.notes ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            Your reason: “{l.notes}”
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          tone={STATUS_TONE[l.status] ?? 'neutral'}
                          label={STATUS_LABEL[l.status] ?? l.status}
                          dot={false}
                        />
                        {l.status === 'approved' ? (
                          <StatusBadge
                            tone={paid ? 'info' : 'neutral'}
                            label={paid ? 'Paid' : 'Unpaid'}
                            dot={false}
                          />
                        ) : null}
                        {l.status === 'applied' ? <WithdrawLeaveButton id={l.id} /> : null}
                      </div>
                    </div>

                    {/* The manager's reply — impossible to show before 0083,
                        because the decision overwrote the applicant's note. */}
                    {l.managerNote ? (
                      <div className="bg-muted/50 mt-2 rounded-md px-3 py-2">
                        <p className="text-xs font-medium">
                          {l.decidedByName ? `${l.decidedByName} replied` : 'Manager replied'}
                        </p>
                        <p className="mt-0.5 text-sm">“{l.managerNote}”</p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
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
