'use client';

// Employee-mode OS app windows — the only apps a role='employee' session sees.
// Self-scoped + non-financial: they call employee-portal.ts actions which
// resolve the employee from the session, so an employee only ever sees their
// own tasks and a safe teammate directory.

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  getMyAttendance,
  listMyTasks,
  listMyTeam,
  updateMyTaskStatus,
  type MyAttendance,
  type TeamMember,
} from '@/lib/server/employee-portal';
import type {
  EmployeeProjectTaskRow,
  ProjectTaskStatus,
} from '@/lib/server/entities/project-tasks';

function WindowShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="main">
      <div className="main-header">
        <h2>{title}</h2>
        <span className="sub">{sub}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: 120,
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/* ---------------------------------- Tasks --------------------------------- */

const TASK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  todo: { label: 'To do', color: 'var(--text-muted)', bg: 'var(--content-2)' },
  in_progress: { label: 'In progress', color: '#2563eb', bg: '#2563eb22' },
  little_delayed: { label: 'Slightly delayed', color: '#d97706', bg: '#d9770622' },
  delayed: { label: 'Delayed', color: '#dc2626', bg: '#dc262622' },
  done: { label: 'Done', color: '#16a34a', bg: '#16a34a22' },
  cancelled: { label: 'Cancelled', color: 'var(--text-muted)', bg: 'var(--content-2)' },
};

const STATUS_OPTIONS: readonly ProjectTaskStatus[] = [
  'todo',
  'in_progress',
  'little_delayed',
  'delayed',
  'done',
  'cancelled',
];

// Optimistic local mirror of the server's completed_at-on-done rule.
function applyStatus(t: EmployeeProjectTaskRow, next: ProjectTaskStatus): EmployeeProjectTaskRow {
  const completedAt =
    next === 'done' ? new Date().toISOString() : t.status === 'done' ? null : t.completedAt;
  return { ...t, status: next, completedAt };
}

export function MyTasksWindow() {
  const [tasks, setTasks] = useState<EmployeeProjectTaskRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyTasks()
      .then((t) => !cancelled && setTasks([...t]))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const changeStatus = async (taskId: string, next: ProjectTaskStatus) => {
    // Optimistic — the row re-groups (open/closed) immediately.
    setTasks((cur) => cur?.map((t) => (t.taskId === taskId ? applyStatus(t, next) : t)) ?? cur);
    const r = await updateMyTaskStatus(taskId, next);
    if (!r.ok) {
      toast.error(r.error || 'Couldn’t update the task.');
      try {
        const fresh = await listMyTasks();
        setTasks([...fresh]); // resync from the server
      } catch {
        /* keep optimistic state */
      }
    }
  };

  let body: React.ReactNode;
  if (error) body = <Muted>Couldn’t load your tasks. Please try again.</Muted>;
  else if (tasks === null) body = <Muted>Loading your tasks…</Muted>;
  else if (tasks.length === 0) body = <Muted>You have no assigned tasks right now.</Muted>;
  else {
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    const done = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled');
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <TaskGroup title={`Open · ${open.length}`} tasks={open} onChangeStatus={changeStatus} />
        {done.length > 0 && (
          <TaskGroup title={`Closed · ${done.length}`} tasks={done} onChangeStatus={changeStatus} />
        )}
      </div>
    );
  }

  return (
    <WindowShell title="My Tasks" sub="tasks assigned to you — set your own status">
      {body}
    </WindowShell>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: ProjectTaskStatus;
  onChange: (s: ProjectTaskStatus) => void;
}) {
  const st = TASK_STATUS[value] ?? {
    label: value,
    color: 'var(--text-muted)',
    bg: 'var(--content-2)',
  };
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProjectTaskStatus)}
      title="Change status"
      style={{
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 999,
        color: st.color,
        background: st.bg,
        border: '1px solid var(--border)',
        cursor: 'pointer',
        appearance: 'none',
      }}
    >
      {STATUS_OPTIONS.map((s) => (
        <option key={s} value={s} style={{ color: 'var(--text)', background: 'var(--content)' }}>
          {(TASK_STATUS[s] ?? { label: s }).label}
        </option>
      ))}
    </select>
  );
}

function TaskGroup({
  title,
  tasks,
  onChangeStatus,
}: {
  title: string;
  tasks: readonly EmployeeProjectTaskRow[];
  onChangeStatus: (taskId: string, next: ProjectTaskStatus) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {tasks.map((t, i) => (
          <div
            key={t.taskId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t.title}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t.projectCode ? `${t.projectCode} · ` : ''}
                {t.projectName}
                {t.dueOn ? ` · due ${t.dueOn}` : ''}
              </div>
            </div>
            <StatusSelect value={t.status} onChange={(s) => onChangeStatus(t.taskId, s)} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------- Team ---------------------------------- */

export function MyTeamWindow() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyTeam()
      .then((t) => !cancelled && setTeam(t))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  let body: React.ReactNode;
  if (error) body = <Muted>Couldn’t load the team directory.</Muted>;
  else if (team === null) body = <Muted>Loading your team…</Muted>;
  else if (team.length === 0) body = <Muted>No teammates to show.</Muted>;
  else {
    body = (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10,
        }}
      >
        {team.map((m) => {
          const name = m.displayName || m.fullName;
          return (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: m.isSelf ? 'var(--content-2)' : 'transparent',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  background: 'var(--content-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {initials(name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {name}
                  {m.isSelf ? ' (you)' : ''}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {m.designation ?? '—'}
                  {m.department ? ` · ${m.department}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <WindowShell title="Team" sub="your teammates — names & roles only">
      {body}
    </WindowShell>
  );
}

/* ------------------------------ My Attendance ----------------------------- */

const ATT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: 'Present', color: '#16a34a', bg: '#16a34a22' },
  work_from_home: { label: 'WFH', color: '#2563eb', bg: '#2563eb22' },
  half_day: { label: 'Half day', color: '#d97706', bg: '#d9770622' },
  on_leave: { label: 'On leave', color: '#7c3aed', bg: '#7c3aed22' },
  absent: { label: 'Absent', color: '#dc2626', bg: '#dc262622' },
  weekly_off: { label: 'Weekly off', color: 'var(--text-muted)', bg: 'var(--content-2)' },
  holiday: { label: 'Holiday', color: '#0891b2', bg: '#0891b222' },
};
const ATT_FALLBACK = { label: '', color: 'var(--text-muted)', bg: 'var(--content-2)' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = WEEKDAYS[d.getUTCDay()] ?? '';
  const mo = MONTHS_ABBR[d.getUTCMonth()] ?? '';
  return `${wd} ${String(d.getUTCDate()).padStart(2, '0')} ${mo}`;
}

export function MyAttendanceWindow() {
  const todayISO = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(
      n.getDate(),
    ).padStart(2, '0')}`;
  }, []);
  const [month, setMonth] = useState(() => todayISO.slice(0, 7));
  const [data, setData] = useState<MyAttendance | null>(null);
  const [errMonth, setErrMonth] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only setState in the async callbacks (never synchronously in the effect).
    getMyAttendance(month, todayISO)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErrMonth(month);
      });
    return () => {
      cancelled = true;
    };
  }, [month, todayISO]);

  // Derived — no reset-setState in the effect. `loading` = we don't yet have
  // data for the selected month; `error` = the selected month failed to load.
  const error = errMonth === month;
  const loading = !error && data?.month !== month;
  const s = !loading && !error ? data?.summary : undefined;
  const notable =
    !loading && !error
      ? (data?.days ?? []).filter(
          (d) => !d.isFuture && d.status !== 'present' && d.status !== 'weekly_off',
        )
      : [];
  const headerLabel = `${MONTHS_ABBR[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;

  return (
    <WindowShell title="My Attendance" sub="your month at a glance">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <NavBtn label="‹" onClick={() => setMonth((m) => shiftMonth(m, -1))} />
          <div style={{ minWidth: 140, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
            {headerLabel}
          </div>
          <NavBtn label="›" onClick={() => setMonth((m) => shiftMonth(m, 1))} />
        </div>

        {error ? (
          <Muted>Couldn’t load your attendance. Please try again.</Muted>
        ) : loading || !s ? (
          <Muted>Loading your attendance…</Muted>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <div style={{ fontSize: 30, fontWeight: 700 }}>
                {s.attendancePct === null ? '—' : `${s.attendancePct}%`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                attendance · {s.workingDays} working {s.workingDays === 1 ? 'day' : 'days'} so far
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Present" n={s.present} status="present" />
              <Chip label="WFH" n={s.workFromHome} status="work_from_home" />
              <Chip label="Half day" n={s.halfDay} status="half_day" />
              <Chip label="On leave" n={s.onLeave} status="on_leave" />
              <Chip label="Absent" n={s.absent} status="absent" />
              {s.holiday > 0 ? <Chip label="Holiday" n={s.holiday} status="holiday" /> : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                Exceptions this month
              </div>
              {notable.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Nothing to flag — all present or weekly-off so far.
                </div>
              ) : (
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}
                >
                  {notable.map((d, i) => {
                    const st = ATT_STATUS[d.status] ?? ATT_FALLBACK;
                    return (
                      <div
                        key={d.date}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '9px 12px',
                          borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        }}
                      >
                        <div style={{ flex: 1, fontSize: 13 }}>{formatDay(d.date)}</div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 999,
                            color: st.color,
                            background: st.bg,
                          }}
                        >
                          {st.label || d.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Days without a marked exception default to Present (Mon–Sat) or Weekly-off (Sun). To
              correct a day, ask your manager or HR.
            </div>
          </>
        )}
      </div>
    </WindowShell>
  );
}

function NavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--content-2)',
        color: 'var(--text)',
        cursor: 'pointer',
        fontSize: 15,
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}

function Chip({ label, n, status }: { label: string; n: number; status: string }) {
  const st = ATT_STATUS[status] ?? ATT_FALLBACK;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: st.bg,
        color: st.color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span>{n}</span>
      <span style={{ opacity: 0.85 }}>{label}</span>
    </div>
  );
}
