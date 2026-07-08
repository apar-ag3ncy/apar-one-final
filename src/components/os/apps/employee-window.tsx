'use client';

// Employee profile window — SPEC-AMENDMENT-001 §8.4.
//
// Read-only personal dashboard surfaced inside an OS window. Tabbed layout
// for parity with ClientWindow / VendorWindow (Rule 47). The employee
// themselves edits via the (portal)/me/* Dashboard routes; the OS surface
// is for managers / HR / admin.

import { useEffect, useState } from 'react';

// Tabs are OS-styled (.tabs / .tab) instead of the Radix ProfileTabs so the
// OS theme is preserved on the chrome. Tab content still uses the shared
// Section components — Rule 47 — but the surrounding nav matches the
// legacy ClientDetail / VendorDetail look in apps.tsx.
import { ContactsSection } from '@/components/entity/contacts-section';
import { AddressesSection } from '@/components/entity/addresses-section';
import { AttendanceSection } from '@/components/entity/attendance-section';
import { BankAccountsSection } from '@/components/entity/bank-accounts-section';
import { CompensationSection } from '@/components/entity/compensation-section';
import { TaxIdentifiersSection } from '@/components/entity/tax-identifiers-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { EntityRef } from '@/components/entity/entity-ref';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { DateField } from '@/components/shared/date-field';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import { getEmployeeSummary, type EmployeeSummary } from '@/lib/server/entities/employee-summary';
import { addEmployeeAchievement } from '@/lib/server/entities/employee-achievements';
import {
  listEmployeeProjects,
  listEmployeeProjectTasks,
  type EmployeeProjectMembershipRow,
  type EmployeeProjectTaskRow,
} from '@/lib/server/entities/project-tasks';
import { getEmployeeStatement, type Statement } from '@/lib/server/ledger/statements';
import { listEmployees } from '@/lib/server-stub/entity-actions';
import { Icon } from '../icons';
import { EmployeeProfileEditor } from '../apps';
import { useEntityMutation } from '../auth/entity-mutation-gate';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

type RosterEntry = { id: string; name: string; reportsTo: string | null };

function openDocumentBeside(documentId: string) {
  osActions.openWindow({
    app: 'documents',
    entityId: documentId,
    position: 'beside-focused',
  });
}

export type EmployeeWindowProps = {
  employeeId: string;
  onClose?: () => void;
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      summary: EmployeeSummary;
      contacts: readonly ContactRow[];
      memberships: readonly EmployeeProjectMembershipRow[];
    };

export function EmployeeWindow({ employeeId, onClose }: EmployeeWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<string>('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const [roster, setRoster] = useState<readonly RosterEntry[]>([]);
  const [editing, setEditing] = useState(false);
  // OS edit grant for the employees app (provided by os-root's EntityMutationGate).
  const { canEdit } = useEntityMutation();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getEmployeeSummary(employeeId),
      listContacts({ entityType: 'employee', entityId: employeeId }),
      listEmployees(),
      listEmployeeProjects(employeeId),
    ])
      .then(([summary, contacts, all, memberships]) => {
        if (cancelled) return;
        setState({ kind: 'ready', summary, contacts, memberships });
        setRoster(all.map((e) => ({ id: e.id, name: e.fullName, reportsTo: e.reportsTo })));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load employee',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadKey]);

  if (state.kind === 'loading') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading employee…</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="main" style={{ padding: 24 }}>
        <p style={{ color: 'var(--text-error, #c33)' }}>{state.message}</p>
      </div>
    );
  }

  const { summary, contacts, memberships } = state;
  const { employee, kpis, projectsLed, achievements } = summary;
  // Distinct projects this employee touches — leads + team memberships.
  const projectsCount = new Set([
    ...projectsLed.map((p) => p.id),
    ...memberships.map((m) => m.projectId),
  ]).size;
  // Archive lifecycle is the `is_archived` boolean — independent of the
  // `separated` employment status (you can archive an active employee, and
  // a separated employee may not be archived).
  const isArchived = employee.isArchived;

  const manager = employee.reportsToEmployeeId
    ? (roster.find((r) => r.id === employee.reportsToEmployeeId) ?? null)
    : null;
  const directReports = roster.filter((r) => r.reportsTo === employee.id);

  const tabDefs: ReadonlyArray<{ value: string; label: string; count?: number }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'contacts', label: 'Contacts', count: contacts.length },
    { value: 'addresses', label: 'Addresses' },
    { value: 'bank-tax', label: 'Bank & Tax' },
    { value: 'compensation', label: 'Compensation' },
    { value: 'ledger', label: 'Ledger' },
    { value: 'documents', label: 'Documents' },
    { value: 'projects', label: 'Projects', count: projectsCount },
    { value: 'attendance', label: 'Attendance & leaves' },
    { value: 'achievements', label: 'Achievements', count: achievements.length },
    { value: 'activity', label: 'Activity' },
    { value: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header employee={employee} onEdit={canEdit ? () => setEditing(true) : undefined} />
      <div className="tabs">
        {tabDefs.map((t) => (
          <div
            key={t.value}
            className={`tab ${tab === t.value ? 'active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                }}
              >
                {t.count}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? (
          <OverviewBody
            employee={employee}
            kpis={kpis}
            manager={manager}
            directReports={directReports}
          />
        ) : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            initial={contacts}
          />
        ) : null}
        {tab === 'addresses' ? (
          <AddressesSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
          />
        ) : null}
        {tab === 'bank-tax' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <BankAccountsSection
              entityType="employee"
              entityId={employee.id}
              entityName={employee.fullName}
            />
            <TaxIdentifiersSection
              entityType="employee"
              entityId={employee.id}
              entityName={employee.fullName}
            />
          </div>
        ) : null}
        {tab === 'compensation' ? (
          <CompensationSection employeeId={employee.id} employeeName={employee.fullName} />
        ) : null}
        {tab === 'ledger' ? <EmployeeLedgerBody employeeId={employee.id} /> : null}
        {tab === 'documents' ? (
          <DocumentsSection
            entityType="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            onOpenDocument={openDocumentBeside}
            onUploaded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'projects' ? (
          <ProjectsLedBody
            projects={projectsLed}
            memberships={memberships}
            employeeId={employee.id}
          />
        ) : null}
        {tab === 'attendance' ? (
          <AttendanceSection employeeId={employee.id} employeeName={employee.fullName} />
        ) : null}
        {tab === 'achievements' ? (
          <AchievementsBody
            achievements={achievements}
            employeeId={employee.id}
            canEdit={canEdit}
            onAdded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'activity' ? <ActivityBody employeeId={employee.id} /> : null}
        {tab === 'settings' ? (
          <EntitySettingsSection
            kind="employee"
            entityId={employee.id}
            entityName={employee.fullName}
            isArchived={isArchived}
            onChanged={() => setReloadKey((k) => k + 1)}
            onDeleted={onClose}
          />
        ) : null}
      </div>
      {editing && canEdit ? (
        <EmployeeProfileEditor
          mode="edit"
          employeeId={employee.id}
          roster={roster
            .filter((r) => r.id !== employee.id)
            .map((r) => ({ id: r.id, name: r.name }))}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

function Header({
  employee,
  onEdit,
}: {
  employee: EmployeeSummary['employee'];
  /** Omitted when the user lacks edit permission — the button is then hidden. */
  onEdit?: () => void;
}) {
  return (
    <header
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        // Same gutter as the Client/Vendor/Project window headers — without
        // it the avatar and the Edit button sit flush against the frame.
        padding: '20px 24px 14px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="avatar" style={{ width: 44, height: 44, fontSize: 16, borderRadius: 12 }}>
        {initials(employee.fullName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 17, lineHeight: 1.2 }}>
          {employee.fullName}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {employee.employeeCode ? (
            <>
              <span className="entity-code">{employee.employeeCode}</span>
              {' · '}
            </>
          ) : null}
          {employee.designation ?? '—'}
          {employee.department ? ` · ${employee.department}` : ''}
          {' · joined '}
          {new Date(employee.joinedOn).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 999,
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {employee.status === 'separated' ? 'inactive' : employee.status.replace('_', ' ')}
      </span>
      {onEdit ? (
        <button className="btn" type="button" onClick={onEdit} title="Edit profile">
          <Icon name="edit" size={13} />
          Edit profile
        </button>
      ) : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewBody({
  employee,
  kpis,
  manager,
  directReports,
}: {
  employee: EmployeeSummary['employee'];
  kpis: EmployeeSummary['kpis'];
  manager: RosterEntry | null;
  directReports: readonly RosterEntry[];
}) {
  const fmtDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi
          label="With Apar"
          value={tenureFrom(employee.joinedOn)}
          trend={`since ${fmtDate(employee.joinedOn)}`}
        />
        <Kpi label="Projects" value={kpis.projectsLed} />
        <Kpi
          label="Leaves"
          value={`${kpis.leavesApproved} / ${kpis.leavesApplied}`}
          trend="approved / applied"
        />
        <Kpi label="Reimbursements pending" value={kpis.reimbursementsPending} />
        <Kpi label="Direct reports" value={directReports.length} />
      </div>
      <Card title="Profile">
        <DetailGrid
          items={[
            ['Display name', employee.displayName ?? '—'],
            ['Designation', employee.designation ?? '—'],
            ['Department', employee.department ?? '—'],
            ['Employment type', employee.employmentType.replace('_', ' ')],
            ['Contract', employee.contractStatus],
            ['Work email', employee.workEmail ?? '—'],
            ['Personal email', employee.personalEmail ?? '—'],
            ['Phone', employee.phone ?? '—'],
            ['Joined on', fmtDate(employee.joinedOn)],
            [
              'Date of birth',
              employee.dateOfBirth
                ? (() => {
                    const age = ageInYears(employee.dateOfBirth);
                    return age !== null
                      ? `${fmtDate(employee.dateOfBirth)} (${age} yrs)`
                      : fmtDate(employee.dateOfBirth);
                  })()
                : '—',
            ],
            ['Confirmed on', fmtDate(employee.confirmedOn)],
            ['Separated on', fmtDate(employee.separatedOn)],
            ['Notice period', employee.noticePeriodDays ?? '—'],
            ['PAN', employee.maskedPan ?? '—'],
            ['Aadhaar', employee.maskedAadhaar ?? '—'],
          ]}
        />
      </Card>
      <Card title="Reporting">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 88 }}>
              Reports to
            </span>
            {manager ? (
              <EntityRef
                type="employee"
                id={manager.id}
                label={manager.name}
                hideIcon
                onNavigate={navigateBesideFocused}
              />
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>— No manager —</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 88, marginTop: 2 }}>
              Direct reports
            </span>
            {directReports.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>None</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                {directReports.map((r) => (
                  <EntityRef
                    key={r.id}
                    type="employee"
                    id={r.id}
                    label={r.name}
                    hideIcon
                    onNavigate={navigateBesideFocused}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function ProjectsLedBody({
  projects,
  memberships,
  employeeId,
}: {
  projects: EmployeeSummary['projectsLed'];
  /** Projects this employee is a team member on (project_members). */
  memberships: readonly EmployeeProjectMembershipRow[];
  employeeId: string;
}) {
  const [tasks, setTasks] = useState<readonly EmployeeProjectTaskRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    listEmployeeProjectTasks(employeeId)
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  // Group the tasks-performed list by project so each project heads its tasks.
  const groups: {
    projectId: string;
    projectName: string;
    projectCode: string | null;
    rows: EmployeeProjectTaskRow[];
  }[] = [];
  for (const t of tasks) {
    let g = groups.find((x) => x.projectId === t.projectId);
    if (!g) {
      g = {
        projectId: t.projectId,
        projectName: t.projectName,
        projectCode: t.projectCode,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(t);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SubHeading>Projects led</SubHeading>
        {projects.length === 0 ? (
          <Muted>No active projects led by this employee.</Muted>
        ) : (
          <div style={cardGridStyle}>
            {projects.map((p) => (
              <EmployeeProjectCard
                key={p.id}
                projectId={p.id}
                code={p.code}
                name={p.name}
                clientName={p.clientName}
                status={p.status}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SubHeading>Team member on</SubHeading>
        {memberships.length === 0 ? (
          <Muted>Not on any project team yet.</Muted>
        ) : (
          <div style={cardGridStyle}>
            {memberships.map((m) => (
              <EmployeeProjectCard
                key={m.memberId}
                projectId={m.projectId}
                code={m.projectCode}
                name={m.projectName}
                clientName={m.clientName}
                status={m.projectStatus}
                roleNote={m.roleNote}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SubHeading>Tasks performed</SubHeading>
        {groups.length === 0 ? (
          <Muted>No tasks assigned to this employee.</Muted>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {groups.map((g) => (
              <div key={g.projectId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {g.projectCode ? (
                    <span
                      style={{
                        fontFamily: 'var(--os-font)',
                        fontVariantNumeric: 'tabular-nums',
                        letterSpacing: '0.02em',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {g.projectCode}
                    </span>
                  ) : null}
                  <EntityRef
                    type="project"
                    id={g.projectId}
                    label={g.projectName}
                    hideIcon
                    onNavigate={navigateBesideFocused}
                  />
                </div>
                <ul
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                  }}
                >
                  {g.rows.map((t) => (
                    <li
                      key={t.taskId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '5px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        fontSize: 13,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          textDecoration: t.status === 'done' ? 'line-through' : 'none',
                          color: t.status === 'done' ? 'var(--text-muted)' : 'inherit',
                        }}
                      >
                        {t.title}
                      </span>
                      <TaskStatusBadge status={t.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Project cards — shared by "Projects led" and "Team member on". */

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 8,
};

const PROJECT_DB_STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  pitch: { bg: '#1a3b6e', fg: '#9ec2f0', label: 'Pitch' },
  won: { bg: '#1a5e6e', fg: '#9ee2f0', label: 'Won' },
  active: { bg: '#1f6b3b', fg: '#a4d8b3', label: 'Active' },
  on_hold: { bg: '#7a5a17', fg: '#e7c980', label: 'On hold' },
  completed: { bg: '#3a3a78', fg: '#bdbdf5', label: 'Completed' },
  cancelled: { bg: '#3a3a3a', fg: '#bdbdbd', label: 'Cancelled' },
};

function EmployeeProjectCard({
  projectId,
  code,
  name,
  clientName,
  status,
  roleNote,
}: {
  projectId: string;
  code: string | null;
  name: string;
  clientName: string;
  status: string;
  roleNote?: string | null;
}) {
  const tone = PROJECT_DB_STATUS_TONE[status] ?? {
    bg: '#3a3a3a',
    fg: '#bdbdbd',
    label: status.replace('_', ' '),
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--border)',
        background: 'var(--content-2)',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {code ? (
          <span
            style={{
              fontFamily: 'var(--os-font)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
              fontSize: 10.5,
              color: 'var(--text-muted)',
            }}
          >
            {code}
          </span>
        ) : null}
        <div className="grow" style={{ flex: 1 }} />
        <span
          className="pill"
          style={{ background: tone.bg, color: tone.fg, fontSize: 10.5, padding: '2px 8px' }}
        >
          {tone.label}
        </span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
        <EntityRef
          type="project"
          id={projectId}
          label={name}
          hideIcon
          onNavigate={navigateBesideFocused}
        />
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        for {clientName}
        {roleNote ? ` · ${roleNote}` : ''}
      </div>
    </div>
  );
}

const TASK_STATUS_LABELS: Record<EmployeeProjectTaskRow['status'], string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

const TASK_STATUS_TONE: Record<EmployeeProjectTaskRow['status'], { bg: string; fg: string }> = {
  todo: { bg: '#3a3a3a', fg: '#bdbdbd' },
  in_progress: { bg: '#7a5a17', fg: '#e7c980' },
  done: { bg: '#1f6b3b', fg: '#a4d8b3' },
};

function TaskStatusBadge({ status }: { status: EmployeeProjectTaskRow['status'] }) {
  const tone = TASK_STATUS_TONE[status];
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </h3>
  );
}

function AchievementsBody({
  achievements,
  employeeId,
  canEdit,
  onAdded,
}: {
  achievements: EmployeeSummary['achievements'];
  employeeId: string;
  canEdit: boolean;
  onAdded: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState('');
  const [occurredOn, setOccurredOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = summary.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addEmployeeAchievement({
        employeeId,
        summary: trimmed,
        occurredOn: occurredOn || null,
      });
      setSummary('');
      setOccurredOn('');
      setAdding(false);
      onAdded();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add achievement');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canEdit ? (
        adding ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--content-2)',
            }}
          >
            <input
              className="input"
              autoFocus
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Achievement — e.g. Led the Nykaa launch"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <DateField
                value={occurredOn}
                onChange={(next) => setOccurredOn(next)}
                placeholder="Date (optional)"
                className="w-[150px]"
              />
              <div style={{ flex: 1 }} />
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setAdding(false);
                  setSummary('');
                  setOccurredOn('');
                  setError(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => void save()}
                disabled={saving || summary.trim().length === 0}
              >
                {saving ? 'Adding…' : 'Add'}
              </button>
            </div>
            {error ? (
              <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div>
            ) : null}
          </div>
        ) : (
          <div>
            <button className="btn" type="button" onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} />
              Add achievement
            </button>
          </div>
        )
      ) : null}

      {achievements.length === 0 ? (
        <Muted>
          No achievements recorded. Partners / HR can mark events on the Activity feed as
          achievements via the <code>mark_achievement</code> capability.
        </Muted>
      ) : (
        <ul
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {achievements.map((a) => (
            <li
              key={a.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}
            >
              <Icon name="star" size={14} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div>{a.summary}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(a.at).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityBody({ employeeId }: { employeeId: string }) {
  const { events, isLive } = useRealtimeActivity({
    entityType: 'employee',
    entityId: employeeId,
    fetchEvents: getEntityActivity,
  });
  return (
    <ActivityFeed events={events} isLive={isLive} onNavigate={navigateBesideFocused} showHeader />
  );
}

/* -------------------------------------------------------------------------- */
/* Ledger tab — the employee's own statement of account                        */
/* -------------------------------------------------------------------------- */

function EmployeeLedgerBody({ employeeId }: { employeeId: string }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getEmployeeStatement({ employeeId })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load ledger');
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>;
  }
  return (
    <StatementOfAccount
      statement={statement}
      noun="ledger entries"
      balanceMeaning="Total paid to this employee (Salaries & Wages 6100)"
      exportName={`employee-ledger-${employeeId}`}
      onSelectTransaction={(txnId) =>
        osActions.openWindow({
          app: 'transactions',
          entityId: txnId,
          title: 'Transaction',
          position: 'beside-focused',
        })
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

function Kpi({ label, value, trend }: { label: string; value: number | string; trend?: string }) {
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
      <div className="font-display" style={{ fontSize: 22, marginTop: 2 }}>
        {value}
      </div>
      {trend ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{trend}</div>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
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

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{children}</p>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

/**
 * Human tenure from `from` (YYYY-MM-DD or ISO) to today, e.g. "2 yrs 3 mos".
 * Drops the day component once past a month; shows "X days" under a month.
 * Returns "—" for a missing/unparseable date or a future join date.
 */
function tenureFrom(from: string | null): string {
  if (!from) return '—';
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return '—';
  const now = new Date();
  if (start > now) return '—';

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    // Days in the month before `now` — borrow from it.
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalMonths = years * 12 + months;
  if (totalMonths < 1) {
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'yr' : 'yrs'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'mo' : 'mos'}`);
  return parts.join(' ');
}

/** Whole years from `from` (a date of birth) to today, or null if unusable. */
function ageInYears(from: string | null): number | null {
  if (!from) return null;
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  if (start > now) return null;
  let years = now.getFullYear() - start.getFullYear();
  const beforeBirthday =
    now.getMonth() < start.getMonth() ||
    (now.getMonth() === start.getMonth() && now.getDate() < start.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 ? years : null;
}
