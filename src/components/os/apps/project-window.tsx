'use client';

// OS project profile window. Mirrors the chrome pattern from ClientWindow /
// EmployeeWindow / VendorWindow — header + .tabs / .tab tab bar + OS palette
// via CSS variables — so the OS theme is preserved. Tab bodies reuse the
// shared section components from `@/components/entity/` so behaviour stays
// in sync with the dashboard.

import { useEffect, useState } from 'react';

import { ActivityFeed } from '@/components/entity/activity-feed';
import { EntityRef } from '@/components/entity/entity-ref';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { TransactionList, type Transaction } from '@/components/entity/transaction-list';
import { ProjectStatusChanger } from '@/components/projects/project-status-changer';
import { Icon } from '../icons';
import { useEntityMutation } from '../auth/entity-mutation-gate';
import {
  PROJECT_DB_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from '@/components/projects/types';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { getProject, listProjectTransactions, listEmployees } from '@/lib/server-stub/entity-actions';
import {
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
  listProjectTasks,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  type ProjectMemberRow,
  type ProjectTaskRow,
  type ProjectTaskStatus,
} from '@/lib/server/entities/project-tasks';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

type EmployeeOption = { id: string; name: string };

export type ProjectWindowProps = {
  projectId: string;
  onClose?: () => void;
};

type ProjectTab =
  | 'overview'
  | 'team'
  | 'tasks'
  | 'transactions'
  | 'documents'
  | 'activity'
  | 'settings';

const TAB_LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  team: 'Team',
  tasks: 'Tasks',
  transactions: 'Transactions',
  documents: 'Documents',
  activity: 'Activity',
  settings: 'Settings',
};

const PROJECT_STATUS_TONE: Record<ProjectStatus, { bg: string; fg: string; label: string }> = {
  pitching: { bg: '#1a3b6e', fg: '#9ec2f0', label: 'Pitching' },
  active: { bg: '#1f6b3b', fg: '#a4d8b3', label: 'Active' },
  on_hold: { bg: '#7a5a17', fg: '#e7c980', label: 'On hold' },
  delivered: { bg: '#3a3a78', fg: '#bdbdf5', label: 'Delivered' },
  closed: { bg: '#3a3a3a', fg: '#bdbdbd', label: 'Closed' },
};

type Feed = {
  transactions: readonly Transaction[];
  incomePaise: bigint;
  spendPaise: bigint;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; project: Project; feed: Feed };

export function ProjectWindow({ projectId, onClose }: ProjectWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [reloadKey, setReloadKey] = useState(0);
  // OS edit grant for the projects app (provided by os-root's EntityMutationGate).
  const { canEdit } = useEntityMutation();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ kind: 'loading' });
    });
    Promise.all([getProject(projectId), listProjectTransactions(projectId)])
      .then(([project, feed]) => {
        if (cancelled) return;
        if (!project) {
          setState({ kind: 'error', message: `Project ${projectId} not found.` });
          return;
        }
        setState({ kind: 'ready', project, feed });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load project',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading project…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--text-error, #c33)' }}>{state.message}</div>;
  }

  const { project, feed } = state;
  const tabs: readonly ProjectTab[] = [
    'overview',
    'team',
    'tasks',
    'transactions',
    'documents',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header
        project={project}
        canEdit={canEdit}
        onStatusChanged={() => setReloadKey((k) => k + 1)}
      />
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
            {t === 'transactions' && feed.transactions.length > 0 ? (
              <span style={{ marginLeft: 6, opacity: 0.7 }}>{feed.transactions.length}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? <OverviewBody project={project} feed={feed} /> : null}
        {tab === 'team' ? <TeamBody projectId={project.id} canEdit={canEdit} /> : null}
        {tab === 'tasks' ? <TasksBody projectId={project.id} canEdit={canEdit} /> : null}
        {tab === 'transactions' ? <TransactionsBody project={project} feed={feed} /> : null}
        {tab === 'documents' ? (
          <DocumentsSection
            entityType="project"
            entityId={project.id}
            entityName={project.name}
            onUploaded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'activity' ? <ActivityBody projectId={project.id} /> : null}
        {tab === 'settings' ? (
          <EntitySettingsSection
            kind="project"
            entityId={project.id}
            entityName={project.name}
            isArchived={project.status === 'closed'}
            onChanged={() => setReloadKey((k) => k + 1)}
            onDeleted={onClose}
          />
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

function Header({
  project,
  canEdit,
  onStatusChanged,
}: {
  project: Project;
  canEdit: boolean;
  onStatusChanged?: () => void;
}) {
  const tone = PROJECT_STATUS_TONE[project.status];
  return (
    <div
      style={{
        padding: '20px 24px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      <div
        className="avatar"
        style={{
          width: 56,
          height: 56,
          fontSize: 18,
          background: toneForName(project.name),
          borderRadius: 12,
        }}
      >
        {initials(project.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {project.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          {project.code ? (
            <>
              <span
                style={{
                  fontFamily: 'var(--os-font)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                  fontSize: 12,
                }}
              >
                {project.code}
              </span>
              {' · '}
            </>
          ) : null}
          For{' '}
          <a
            href={`/clients/${project.clientId}`}
            style={{ color: 'var(--text-fg, inherit)' }}
            onClick={(e) => {
              e.preventDefault();
              osActions.openWindow({
                app: 'clients',
                entityId: project.clientId,
                position: 'beside-focused',
              });
            }}
          >
            {project.clientName}
          </a>
          {' · Lead '}
          {project.leadName}
          {' · POC '}
          {project.accountManagerName}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
            <span className="dot" style={{ background: tone.fg }} />
            {tone.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            DB state: {PROJECT_DB_STATUS_LABELS[project.dbStatus]}
          </span>
        </div>
      </div>
      {canEdit ? (
        <div style={{ flexShrink: 0 }}>
          <ProjectStatusChanger
            projectId={project.id}
            value={project.dbStatus}
            onChanged={onStatusChanged}
          />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewBody({ project, feed }: { project: Project; feed: Feed }) {
  const net = feed.incomePaise - feed.spendPaise;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi label="Income" value={formatINRPaise(feed.incomePaise)} tone="success" />
        <Kpi label="Spend" value={formatINRPaise(feed.spendPaise)} />
        <Kpi label="Net" value={formatINRPaise(net)} tone={net >= 0n ? 'success' : 'danger'} />
        <Kpi label="Transactions" value={String(feed.transactions.length)} />
        <Kpi label="Documents" value={String(project.documentsCount)} />
      </div>
      <OsCard title="Project">
        <DetailGrid
          items={[
            ['Client', project.clientName],
            ['Lead', project.leadName],
            ['POC (manager)', project.accountManagerName],
            ['Status', PROJECT_DB_STATUS_LABELS[project.dbStatus]],
            ['Fee', formatINRPaise(project.feePaise)],
            [
              'Started',
              project.startedAt.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              }),
            ],
            [
              'Target end',
              project.endsAt
                ? project.endsAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'Ongoing',
            ],
          ]}
        />
      </OsCard>
      {project.notes ? (
        <OsCard title="Notes">
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {project.notes}
          </p>
        </OsCard>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                                */
/* -------------------------------------------------------------------------- */

function TransactionsBody({ project, feed }: { project: Project; feed: Feed }) {
  const net = feed.incomePaise - feed.spendPaise;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi label="Income" value={formatINRPaise(feed.incomePaise)} tone="success" />
        <Kpi label="Spend" value={formatINRPaise(feed.spendPaise)} />
        <Kpi label="Net" value={formatINRPaise(net)} tone={net >= 0n ? 'success' : 'danger'} />
      </div>
      <TransactionList
        transactions={feed.transactions}
        entityName={project.code || project.name}
        onNavigate={navigateBesideFocused}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Team                                                                        */
/* -------------------------------------------------------------------------- */

function TeamBody({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [members, setMembers] = useState<readonly ProjectMemberRow[]>([]);
  const [employees, setEmployees] = useState<readonly EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    Promise.all([listProjectMembers(projectId), listEmployees()])
      .then(([m, emps]) => {
        if (cancelled) return;
        setMembers(m);
        setEmployees(emps.map((e) => ({ id: e.id, name: e.fullName })));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load team');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const memberIds = new Set(members.map((m) => m.employeeId));
  const available = employees.filter((e) => !memberIds.has(e.id));

  async function addMany(employeeIds: readonly string[]) {
    if (employeeIds.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await Promise.all(
        employeeIds.map((employeeId) => addProjectMember({ projectId, employeeId })),
      );
      setMembers((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev, ...rows.filter((r) => !seen.has(r.id))];
        return merged.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
      });
      setPickerOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add team mates');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeProjectMember({ id });
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading team…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={busy || available.length === 0}
            title={available.length === 0 ? 'Every employee is already on this project.' : undefined}
          >
            <Icon name="plus" size={13} />
            Add team mate
          </button>
          {available.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              All employees are on this project.
            </span>
          ) : null}
        </div>
      ) : null}

      {pickerOpen ? (
        <AddTeamMatesDialog
          available={available}
          busy={busy}
          onCancel={() => setPickerOpen(false)}
          onAdd={(ids) => void addMany(ids)}
        />
      ) : null}

      {error ? <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div> : null}

      {members.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          No team members assigned yet.
        </p>
      ) : (
        <ul
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {members.map((m) => (
            <li
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <div style={{ flex: 1 }}>
                <EntityRef
                  type="employee"
                  id={m.employeeId}
                  label={m.employeeName}
                  hideIcon
                  onNavigate={navigateBesideFocused}
                />
              </div>
              {m.roleNote ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.roleNote}</span>
              ) : null}
              {canEdit ? (
                <button
                  className="btn row-action row-delete"
                  type="button"
                  title="Remove member"
                  onClick={() => void remove(m.id)}
                  disabled={busy}
                >
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Add team mate" popup — multi-select over the employees not yet on the
 * project. Same os-modal chrome as the shared Modal in apps.tsx (checkbox
 * list + search instead of a form).
 */
function AddTeamMatesDialog({
  available,
  busy,
  onCancel,
  onAdd,
}: {
  available: readonly EmployeeOption[];
  busy: boolean;
  onCancel: () => void;
  onAdd: (employeeIds: readonly string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const q = query.trim().toLowerCase();
  const filtered = q ? available.filter((e) => e.name.toLowerCase().includes(q)) : available;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="os-modal-overlay" onMouseDown={onCancel}>
      <div className="os-modal" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            Add team mates
          </div>
          <button className="btn" type="button" onClick={onCancel} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="os-modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search employees…"
              />
              <button
                className="btn"
                type="button"
                onClick={() => setSelected(new Set(filtered.map((e) => e.id)))}
                disabled={filtered.length === 0}
              >
                All
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
              >
                Clear
              </button>
            </div>

            {filtered.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, padding: '8px 2px' }}>
                {available.length === 0
                  ? 'Every employee is already on this project.'
                  : `No employees match “${query}”.`}
              </p>
            ) : (
              <ul
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {filtered.map((e) => (
                  <li key={e.id}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        fontSize: 13,
                        cursor: 'pointer',
                        background: selected.has(e.id) ? 'var(--hover)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggle(e.id)}
                        style={{ accentColor: 'var(--accent, #4a72ff)' }}
                      />
                      <span style={{ flex: 1 }}>{e.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                paddingTop: 6,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button className="btn" type="button" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => onAdd([...selected])}
                disabled={busy || selected.size === 0}
              >
                <Icon name="plus" size={13} />
                {busy
                  ? 'Adding…'
                  : selected.size === 0
                    ? 'Add team mates'
                    : `Add ${selected.size} team mate${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

const TASK_STATUSES: ReadonlyArray<{ value: ProjectTaskStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

function TasksBody({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [tasks, setTasks] = useState<readonly ProjectTaskRow[]>([]);
  // Assignee options are the project's TEAM (project_members), not the whole
  // employee directory — only people on the project can pick up its tasks.
  const [team, setTeam] = useState<readonly EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-task inline form state. Due date starts at today — the common case —
  // and stays editable.
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueOn, setDueOn] = useState(todayISODate());

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    Promise.all([listProjectTasks(projectId), listProjectMembers(projectId)])
      .then(([t, members]) => {
        if (cancelled) return;
        setTasks(t);
        setTeam(members.map((m) => ({ id: m.employeeId, name: m.employeeName })));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load tasks');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // A task may still point at someone who has since left the team; keep that
  // assignee visible in its row's dropdown so the selection doesn't misrender.
  function optionsFor(task?: ProjectTaskRow): readonly EmployeeOption[] {
    if (
      task?.assigneeEmployeeId &&
      !team.some((m) => m.id === task.assigneeEmployeeId)
    ) {
      return [
        ...team,
        { id: task.assigneeEmployeeId, name: `${task.assigneeName ?? 'Unknown'} (not on team)` },
      ];
    }
    return team;
  }

  function replaceTask(row: ProjectTaskRow) {
    setTasks((prev) => prev.map((t) => (t.id === row.id ? row : t)));
  }

  async function addTask() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await createProjectTask({
        projectId,
        title: t,
        assigneeEmployeeId: assignee || null,
        dueOn: dueOn || null,
      });
      setTasks((prev) => [...prev, row]);
      setTitle('');
      setAssignee('');
      setDueOn(todayISODate());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add task');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: ProjectTaskStatus) {
    setBusy(true);
    setError(null);
    try {
      const row = await updateProjectTask({ id, status });
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignee(id: string, assigneeEmployeeId: string) {
    setBusy(true);
    setError(null);
    try {
      const row = await updateProjectTask({ id, assigneeEmployeeId: assigneeEmployeeId || null });
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update task');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProjectTask({ id });
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete task');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading tasks…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canEdit ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: 12,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--content-2)',
          }}
        >
          <input
            className="input"
            style={{ flex: '1 1 200px' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New task title…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTask();
              }
            }}
          />
          <select
            className="input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            title={
              team.length === 0
                ? 'Add team mates in the Team tab to assign tasks.'
                : 'Assignee (optional)'
            }
          >
            <option value="">{team.length === 0 ? 'No team mates yet' : 'Unassigned'}</option>
            {team.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            title="Due date (optional)"
          />
          <button
            className="btn primary"
            type="button"
            onClick={() => void addTask()}
            disabled={busy || title.trim().length === 0}
          >
            <Icon name="plus" size={13} />
            Add task
          </button>
        </div>
      ) : null}

      {error ? <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div> : null}

      {tasks.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No tasks yet.</p>
      ) : (
        <ul
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {tasks.map((t) => {
            const done = t.status === 'done';
            return (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 13,
                  opacity: done ? 0.7 : 1,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textDecoration: done ? 'line-through' : 'none',
                    color: done ? 'var(--text-muted)' : 'inherit',
                  }}
                >
                  {t.title}
                  {t.dueOn ? (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                      due{' '}
                      {new Date(t.dueOn).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                  ) : null}
                </span>
                {canEdit ? (
                  <>
                    <select
                      className="input"
                      value={t.assigneeEmployeeId ?? ''}
                      onChange={(e) => void changeAssignee(t.id, e.target.value)}
                      disabled={busy}
                      title="Assignee"
                    >
                      <option value="">Unassigned</option>
                      {optionsFor(t).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={t.status}
                      onChange={(e) => void changeStatus(t.id, e.target.value as ProjectTaskStatus)}
                      disabled={busy}
                      title="Status"
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn row-action row-delete"
                      type="button"
                      title="Delete task"
                      onClick={() => void remove(t.id)}
                      disabled={busy}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    {t.assigneeName ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t.assigneeName}
                      </span>
                    ) : null}
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {TASK_STATUSES.find((s) => s.value === t.status)?.label ?? t.status}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

function ActivityBody({ projectId }: { projectId: string }) {
  const { events, isLive } = useRealtimeActivity({
    entityType: 'project',
    entityId: projectId,
    fetchEvents: getEntityActivity,
  });
  return (
    <ActivityFeed events={events} isLive={isLive} onNavigate={navigateBesideFocused} showHeader />
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  const valueColor =
    tone === 'success' ? '#7ed099' : tone === 'danger' ? '#e69b9b' : 'var(--text-fg, inherit)';
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        className="font-display"
        style={{
          fontSize: 22,
          marginTop: 2,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

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
        gap: 8,
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

function DetailGrid({ items }: { items: ReadonlyArray<[string, string]> }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px 16px',
        margin: 0,
        fontSize: 13,
      }}
    >
      {items.map(([label, value]) => (
        <div key={label}>
          <dt
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {label}
          </dt>
          <dd style={{ margin: 0 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function todayISODate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TONES = ['#7A4E2D', '#3F4E8E', '#5E7344', '#7A2D4E', '#2D5E7A', '#7A6A2D'] as const;
function toneForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % TONES.length;
  return TONES[idx]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function formatINRPaise(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = Number(abs) / 100;
  const formatted = rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return negative ? `-${formatted}` : formatted;
}
