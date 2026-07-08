'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  clearAttendance,
  getLeaveBalance,
  listAttendance,
  markAttendance,
  type AttendanceRow,
  type AttendanceStatus,
  type LeaveBalanceRow,
} from '@/lib/server/entities/attendance';
import { defaultStatusForDate } from '@/lib/attendance-defaults';
import { applyLeave, listEmployeeLeaves, type LeaveRow } from '@/lib/server/entities/payroll';
import { DateField } from '@/components/shared/date-field';

/**
 * OS-themed Attendance + Leaves section for the employee profile.
 *
 * Features:
 *   - "Mark today" row with the seven status options.
 *   - Last-30-days strip showing colored cells per day; click a day to
 *     mark / change its status; long-press / × clears it.
 *   - Leave balance cards per kind (earned / casual / sick / unpaid /
 *     comp_off / maternity / paternity) showing taken vs entitled for
 *     the current Indian FY.
 *   - Inline "Apply leave" form that submits via the existing
 *     applyLeave server action.
 *   - Recent leaves list (status + dates).
 *
 * All styles use CSS variables defined in `app/(os)/os/os.css` so the
 * OS dark theme renders correctly.
 */

export type AttendanceSectionProps = {
  employeeId: string;
  employeeName: string;
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  work_from_home: 'WFH',
  absent: 'Absent',
  half_day: 'Half-day',
  on_leave: 'On leave',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: '#2e8f5a',
  work_from_home: '#3f6fb0',
  absent: '#c34a2c',
  half_day: '#c98a2e',
  on_leave: '#7a4eaf',
  weekly_off: '#5a5a5a',
  holiday: '#8a6a2d',
};

const LEAVE_LABEL: Record<LeaveBalanceRow['kind'], string> = {
  earned: 'Earned',
  casual: 'Casual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  comp_off: 'Comp off',
  maternity: 'Maternity',
  paternity: 'Paternity',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBack(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AttendanceSection({ employeeId, employeeName }: AttendanceSectionProps) {
  const [attendance, setAttendance] = useState<readonly AttendanceRow[] | null>(null);
  const [balance, setBalance] = useState<readonly LeaveBalanceRow[] | null>(null);
  const [leaveList, setLeaveList] = useState<readonly LeaveRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const fromDate = useMemo(() => daysBack(29), []);
  const toDate = useMemo(() => todayISO(), []);

  async function reload() {
    try {
      const [a, b, l] = await Promise.all([
        listAttendance({ employeeId, fromDate, toDate }),
        getLeaveBalance({ employeeId }),
        listEmployeeLeaves(employeeId),
      ]);
      setAttendance(a);
      setBalance(b);
      setLeaveList(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load attendance');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listAttendance({ employeeId, fromDate, toDate }),
      getLeaveBalance({ employeeId }),
      listEmployeeLeaves(employeeId),
    ])
      .then(([a, b, l]) => {
        if (cancelled) return;
        setAttendance(a);
        setBalance(b);
        setLeaveList(l);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Load failed');
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, fromDate, toDate]);

  async function mark(date: string, status: AttendanceStatus) {
    setBusy(true);
    try {
      await markAttendance({ employeeId, date, status });
      toast.success(`${STATUS_LABEL[status]} marked for ${formatDay(date)}.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark attendance');
    } finally {
      setBusy(false);
    }
  }

  async function clear(date: string) {
    setBusy(true);
    try {
      await clearAttendance({ employeeId, date });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear');
    } finally {
      setBusy(false);
    }
  }

  if (attendance === null || balance === null || leaveList === null) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading attendance…
      </div>
    );
  }

  const attendanceByDate = new Map(attendance.map((a) => [a.date, a]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Mark today */}
      <OsCard title="Mark today">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              'present',
              'work_from_home',
              'absent',
              'half_day',
              'on_leave',
              'weekly_off',
              'holiday',
            ] as AttendanceStatus[]
          ).map((s) => {
            const today = todayISO();
            // Show the effective status (default if no override).
            const current = attendanceByDate.get(today)?.status ?? defaultStatusForDate(today);
            const isActive = current === s;
            return (
              <button
                key={s}
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => mark(today, s)}
                style={{
                  background: isActive ? STATUS_COLOR[s] : 'var(--content-2)',
                  color: isActive ? '#fff' : 'var(--text)',
                  borderColor: isActive ? STATUS_COLOR[s] : 'var(--border)',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: STATUS_COLOR[s],
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }}
                />
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, marginTop: 6 }}>
          Click again to change; current selection for today is highlighted. {employeeName}.
        </p>
      </OsCard>

      {/* Recent days strip */}
      <OsCard title="Last 30 days">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(10, minmax(60px, 1fr))',
            gap: 6,
          }}
        >
          {Array.from({ length: 30 }).map((_, i) => {
            const date = daysBack(29 - i);
            const rec = attendanceByDate.get(date);
            // Default is implicit: Sunday=weekly_off, otherwise Present.
            // Only stored records render as "override" (full opacity);
            // defaults render slightly faded.
            const effectiveStatus: AttendanceStatus = rec?.status ?? defaultStatusForDate(date);
            const bg = STATUS_COLOR[effectiveStatus];
            return (
              <div
                key={date}
                style={{
                  background: bg,
                  color: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 4px',
                  fontSize: 11,
                  textAlign: 'center',
                  cursor: 'pointer',
                  position: 'relative',
                  opacity: rec ? 1 : 0.55,
                }}
                onClick={() => mark(date, nextStatus(effectiveStatus))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (rec) void clear(date);
                }}
                title={`${formatDay(date)} · ${STATUS_LABEL[effectiveStatus]}${rec ? ' (override)' : ' (default)'}\nLeft-click cycles, right-click clears the override`}
              >
                <div style={{ fontSize: 9, opacity: 0.85, lineHeight: 1.1 }}>
                  {formatWeekday(date)}
                </div>
                <div style={{ fontWeight: 600, lineHeight: 1.15 }}>
                  {new Date(date).getDate()} {formatMonth(date)}
                </div>
                <div style={{ fontSize: 9, opacity: 0.85, lineHeight: 1.1 }}>
                  {STATUS_LABEL[effectiveStatus]}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, marginTop: 6 }}>
          Click a day to cycle through statuses; right-click clears.
        </p>
      </OsCard>

      {/* Leave balance */}
      <OsCard title="Leave balance (this FY)">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          {balance.map((b) => (
            <div
              key={b.kind}
              style={{
                background: 'var(--content-3, var(--content-2))',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                }}
              >
                {LEAVE_LABEL[b.kind]}
              </div>
              <div className="font-display" style={{ fontSize: 22, marginTop: 2 }}>
                {b.entitled === null ? `${b.daysTaken}` : `${b.daysTaken} / ${b.entitled}`}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {b.entitled === null
                  ? `${b.daysTaken} day${b.daysTaken === 1 ? '' : 's'} taken`
                  : `${b.remaining} left`}
              </div>
            </div>
          ))}
        </div>
      </OsCard>

      {/* Apply leave + recent leaves */}
      <ApplyLeaveCard employeeId={employeeId} onApplied={reload} />

      <OsCard title="Recent leaves">
        {leaveList.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            No leaves applied yet.
          </p>
        ) : (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {leaveList.slice(0, 12).map((l) => (
              <li
                key={l.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background:
                      l.status === 'approved'
                        ? '#2e8f5a'
                        : l.status === 'rejected'
                          ? '#c34a2c'
                          : 'var(--text-muted)',
                  }}
                />
                <span style={{ textTransform: 'capitalize' }}>{l.kind.replace('_', ' ')}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {formatDay(l.fromDate)}
                  {l.fromDate !== l.toDate ? ` → ${formatDay(l.toDate)}` : ''}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {l.days} day{Number(l.days) === 1 ? '' : 's'}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    textTransform: 'uppercase',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.05em',
                  }}
                >
                  {l.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </OsCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Apply-leave inline form                                                    */
/* -------------------------------------------------------------------------- */

function ApplyLeaveCard({ employeeId, onApplied }: { employeeId: string; onApplied: () => void }) {
  const [kind, setKind] = useState<LeaveBalanceRow['kind']>('casual');
  const [fromDate, setFromDate] = useState(todayISO());
  const [toDate, setToDate] = useState(todayISO());
  const [days, setDays] = useState('1');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fromDate || !toDate) {
      toast.error('Pick both from-date and to-date.');
      return;
    }
    if (!/^\d+(\.\d)?$/.test(days)) {
      toast.error('Days must be a number (half-day allowed, e.g. 1.5).');
      return;
    }
    setBusy(true);
    try {
      await applyLeave({
        employeeId,
        kind,
        fromDate,
        toDate,
        days,
        notes: notes.trim() || null,
      });
      toast.success('Leave applied. Awaiting approval.');
      setNotes('');
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply leave');
    } finally {
      setBusy(false);
    }
  }

  return (
    <OsCard title="Apply leave">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
        }}
      >
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LeaveBalanceRow['kind'])}
            disabled={busy}
            className="header-select"
            style={selectStyle}
          >
            {(Object.keys(LEAVE_LABEL) as LeaveBalanceRow['kind'][]).map((k) => (
              <option key={k} value={k}>
                {LEAVE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <DateField
            value={fromDate}
            onChange={(next) => setFromDate(next)}
            disabled={busy}
            clearable={false}
          />
        </Field>
        <Field label="To">
          <DateField
            value={toDate}
            onChange={(next) => setToDate(next)}
            disabled={busy}
            clearable={false}
          />
        </Field>
        <Field label="Days">
          <input
            type="text"
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy}
            placeholder="1 or 1.5"
            style={inputStyle}
          />
        </Field>
      </div>
      <div>
        <label
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Notes (optional)
        </label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          placeholder="Reason / hand-off"
          style={{ ...inputStyle, width: '100%' }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Applying…' : 'Apply leave'}
        </button>
      </div>
    </OsCard>
  );
}

/* -------------------------------------------------------------------------- */
/* OS-themed building blocks                                                  */
/* -------------------------------------------------------------------------- */

function OsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          margin: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--content)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '6px 8px',
  fontSize: 13,
};

const selectStyle: React.CSSProperties = { ...inputStyle };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function nextStatus(current?: AttendanceStatus): AttendanceStatus {
  const order: AttendanceStatus[] = [
    'present',
    'work_from_home',
    'half_day',
    'on_leave',
    'absent',
    'weekly_off',
    'holiday',
  ];
  if (!current) return 'present';
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length]!;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short' });
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short' });
}
