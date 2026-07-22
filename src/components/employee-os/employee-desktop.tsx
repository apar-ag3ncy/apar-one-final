'use client';

// The employee workspace — the restricted surface an employee sees at /os
// instead of the admin desktop. Deliberately a separate, simpler shell: it
// only ever renders employee-safe panels (tasks, team, attendance), so no
// accounting / ledger / settings code path is reachable here at all.
//
// Rendered by (os)/os/page.tsx when a valid employee session is present.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarCheckIcon,
  ListTodoIcon,
  LogOutIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

import type { SafeEmployee } from '@/lib/server/employee-auth';
import { signOutEmployee } from '@/lib/server/employee-auth';
import { listMyTeam, listMyTasks, type TeamMember } from '@/lib/server/employee-portal';
import type { EmployeeProjectTaskRow } from '@/lib/server/entities/project-tasks';

type PanelId = 'tasks' | 'team' | 'attendance';

const NAV: ReadonlyArray<{ id: PanelId; label: string; icon: LucideIcon }> = [
  { id: 'tasks', label: 'My Tasks', icon: ListTodoIcon },
  { id: 'team', label: 'Teams', icon: UsersIcon },
  { id: 'attendance', label: 'My Attendance', icon: CalendarCheckIcon },
];

export function EmployeeDesktop({ employee }: { employee: SafeEmployee }) {
  const [panel, setPanel] = useState<PanelId>('tasks');
  const router = useRouter();
  const [signingOut, startSignOut] = useTransition();

  const displayName = employee.displayName || employee.fullName;

  const signOut = () =>
    startSignOut(async () => {
      await signOutEmployee();
      router.replace('/login');
    });

  return (
    <div className="bg-background text-foreground flex h-screen w-full overflow-hidden">
      {/* Sidebar */}
      <aside className="bg-card flex w-60 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <img src="/brand/apar-orange-square.png" alt="Apār" className="size-6 rounded" />
          <span className="text-sm font-semibold tracking-tight">Apār · My Workspace</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = panel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPanel(item.id)}
                className={
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ' +
                  (active
                    ? 'bg-primary/10 text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50')
                }
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-2 border-t p-3">
          <div className="px-2.5">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {employee.designation ?? employee.employeeCode}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm disabled:opacity-60"
          >
            <LogOutIcon className="size-4" aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <h1 className="text-sm font-medium">
            {panel === 'tasks' && 'My Tasks'}
            {panel === 'team' && 'Teams'}
            {panel === 'attendance' && 'My Attendance'}
          </h1>
          <span className="text-muted-foreground ml-auto text-sm">
            Hi {displayName.split(' ')[0]}
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {panel === 'tasks' && <TasksPanel />}
          {panel === 'team' && <TeamPanel />}
          {panel === 'attendance' && <ComingSoon label="My Attendance" />}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

const TASK_STATUS: Record<string, { label: string; className: string }> = {
  todo: { label: 'To do', className: 'bg-muted text-muted-foreground' },
  in_progress: {
    label: 'In progress',
    className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  little_delayed: {
    label: 'Slightly delayed',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  delayed: { label: 'Delayed', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  done: { label: 'Done', className: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground line-through' },
};

function TasksPanel() {
  const [tasks, setTasks] = useState<readonly EmployeeProjectTaskRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyTasks()
      .then((t) => !cancelled && setTasks(t))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <PanelMessage>Couldn’t load your tasks. Please try again.</PanelMessage>;
  if (tasks === null) return <PanelMessage>Loading your tasks…</PanelMessage>;
  if (tasks.length === 0) return <PanelMessage>You have no assigned tasks right now.</PanelMessage>;

  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TaskGroup title={`Open (${open.length})`} tasks={open} />
      {done.length > 0 && <TaskGroup title={`Closed (${done.length})`} tasks={done} />}
    </div>
  );
}

function TaskGroup({ title, tasks }: { title: string; tasks: readonly EmployeeProjectTaskRow[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <ul className="divide-border bg-card divide-y rounded-lg border">
        {tasks.map((t) => {
          const st = TASK_STATUS[t.status] ?? {
            label: t.status,
            className: 'bg-muted text-muted-foreground',
          };
          return (
            <li key={t.taskId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.title}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {t.projectCode ? `${t.projectCode} · ` : ''}
                  {t.projectName}
                  {t.dueOn ? ` · due ${t.dueOn}` : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}
              >
                {st.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TeamPanel() {
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

  if (error)
    return <PanelMessage>Couldn’t load the team directory. Please try again.</PanelMessage>;
  if (team === null) return <PanelMessage>Loading your team…</PanelMessage>;
  if (team.length === 0) return <PanelMessage>No teammates to show.</PanelMessage>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {team.map((m) => {
        const name = m.displayName || m.fullName;
        return (
          <div
            key={m.id}
            className={
              'bg-card flex items-center gap-3 rounded-lg border p-3 ' +
              (m.isSelf ? 'ring-primary/40 ring-1' : '')
            }
          >
            <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium">
              {initials(name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {name}
                {m.isSelf && <span className="text-muted-foreground"> (you)</span>}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {m.designation ?? '—'}
                {m.department ? ` · ${m.department}` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <PanelMessage>{label} is coming soon — you’ll be able to see it here shortly.</PanelMessage>
  );
}

function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-full min-h-40 items-center justify-center text-sm">
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
