'use client';

// OS project profile window. Mirrors the chrome pattern from ClientWindow /
// EmployeeWindow / VendorWindow — header + .tabs / .tab tab bar + OS palette
// via CSS variables — so the OS theme is preserved. Tab bodies reuse the
// shared section components from `@/components/entity/` so behaviour stays
// in sync with the dashboard.

import { useCallback, useEffect, useState } from 'react';

import { ActivityFeed } from '@/components/entity/activity-feed';
import { EntityRef } from '@/components/entity/entity-ref';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { TransactionList, type Transaction } from '@/components/entity/transaction-list';
import { ProjectStatusChanger } from '@/components/projects/project-status-changer';
import { DateField } from '@/components/shared/date-field';
import { Icon } from '../icons';
import { useEntityMutation } from '../auth/entity-mutation-gate';
import {
  PROJECT_DB_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from '@/components/projects/types';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import {
  getProject,
  listProjectTransactions,
  listEmployees,
  listVendors,
} from '@/lib/server-stub/entity-actions';
import {
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
  listProjectVendors,
  addProjectVendor,
  removeProjectVendor,
  listProjectTasks,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  type ProjectMemberRow,
  type ProjectVendorRow,
  type ProjectTaskAssignee,
  type ProjectTaskPriority,
  type ProjectTaskRow,
  type ProjectTaskSource,
  type ProjectTaskStatus,
} from '@/lib/server/entities/project-tasks';
import {
  archiveDeliverableCategory,
  createDeliverableCategory,
  listDeliverableCategories,
  type DeliverableCategoryRow,
} from '@/lib/server/entities/deliverable-categories';
import {
  createProject,
  listSubProjects,
  updateProject,
  type ProjectListRow,
} from '@/lib/server/entities/projects';
import {
  linkInvoiceToProject,
  listInvoicesForProject,
  listUnattributedInvoicesForClient,
  type ProjectInvoiceRow,
} from '@/lib/server/billing/invoice-project-links';
import { getAmountsReceivedByProject } from '@/lib/server/billing/project-receipts';
import { getClientBillingReadiness } from '@/lib/server/billing/invoices';
import { listInvoiceThemes, type InvoiceThemeSummary } from '@/lib/server/billing/invoice-themes';
import {
  listCompanyBankAccountOptions,
  type CompanyBankAccountOption,
} from '@/lib/server/settings/company';
import { InvoiceComposerDialog } from '@/components/entity/billing/invoice-composer';
import { colToDbStatus, dbStatusToCol } from '@/lib/project-status';
import { toast } from 'sonner';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';
import { openInvoiceById, openTransactionOrInvoice } from './open-invoice';
import { Modal } from './os-modal-kit';
import { ProjectFormModal, type ProjectFormSubmit } from './project-form-modal';

type EmployeeOption = { id: string; name: string };
type VendorOption = { id: string; name: string };
/**
 * An option in the deliverable assignee picker (0073). `department` groups
 * employees; vendors carry none. `id` is an employee id in employee mode, a
 * vendor id in vendor mode.
 */
type AssigneeOption = { id: string; name: string; department?: string | null };

export type ProjectWindowProps = {
  projectId: string;
  onClose?: () => void;
};

type ProjectTab =
  | 'overview'
  | 'team'
  | 'tasks'
  | 'invoices'
  | 'transactions'
  | 'documents'
  | 'activity'
  | 'settings';

const TAB_LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
  team: 'Team',
  tasks: 'Deliverables',
  invoices: 'Invoices',
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
  | {
      kind: 'ready';
      project: Project;
      feed: Feed;
      subs: readonly ProjectListRow[];
      /** "Received till now" — parent + sub-projects, allocation-apportioned. */
      receivedPaise: bigint;
    };

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
      .then(async ([project, feed]) => {
        if (cancelled) return;
        if (!project) {
          setState({ kind: 'error', message: `Project ${projectId} not found.` });
          return;
        }
        const subs =
          project.subProjectCount > 0 ? await listSubProjects(projectId).catch(() => []) : [];
        const received = await getAmountsReceivedByProject([
          projectId,
          ...subs.map((s) => s.id),
        ]).catch(() => []);
        if (cancelled) return;
        const receivedPaise = received.reduce((acc, r) => acc + r.receivedPaise, 0n);
        setState({ kind: 'ready', project, feed, subs, receivedPaise });
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

  // The money feed is loaded ONCE when the window opens, but transactions are
  // recorded from other windows (receipts, payments, journals) while this one
  // stays open. Refetch just the feed — no full-window "loading" flash —
  // whenever the Transactions tab becomes active, and on the manual Refresh
  // button in that tab.
  const refreshFeed = useCallback(async () => {
    try {
      const feed = await listProjectTransactions(projectId);
      setState((prev) => (prev.kind === 'ready' ? { ...prev, feed } : prev));
    } catch {
      /* non-fatal — keep showing the last-known feed */
    }
  }, [projectId]);

  useEffect(() => {
    if (tab !== 'transactions') return;
    // Deferred via microtask so the lint doesn't see a synchronous setState
    // inside the effect body (same idiom as the loaders above).
    queueMicrotask(() => void refreshFeed());
  }, [tab, refreshFeed]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading project…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--text-error, #c33)' }}>{state.message}</div>;
  }

  const { project, feed, subs, receivedPaise } = state;
  const tabs: readonly ProjectTab[] = [
    'overview',
    'team',
    'tasks',
    'invoices',
    'transactions',
    'documents',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header
        project={project}
        subs={subs}
        canEdit={canEdit}
        onStatusChanged={() => setReloadKey((k) => k + 1)}
        onEdited={() => setReloadKey((k) => k + 1)}
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
        {tab === 'overview' ? (
          <OverviewBody
            project={project}
            feed={feed}
            subs={subs}
            receivedPaise={receivedPaise}
            canEdit={canEdit}
            onSubsChanged={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'team' ? <TeamBody projectId={project.id} canEdit={canEdit} /> : null}
        {tab === 'tasks' ? (
          <TasksBody
            projectId={project.id}
            canEdit={canEdit}
            parentName={project.name}
            subProjects={subs.map((sp) => ({ id: sp.id, name: sp.name, code: sp.code }))}
          />
        ) : null}
        {tab === 'invoices' ? (
          <InvoicesBody
            project={project}
            canEdit={canEdit}
            onChanged={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'transactions' ? (
          <TransactionsBody project={project} feed={feed} onRefresh={refreshFeed} />
        ) : null}
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
  subs,
  canEdit,
  onStatusChanged,
  onEdited,
}: {
  project: Project;
  subs: readonly ProjectListRow[];
  canEdit: boolean;
  onStatusChanged?: () => void;
  onEdited?: () => void;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const tone = PROJECT_STATUS_TONE[project.status];

  // Same guarded patch as ProjectsApp.updateProjectAction: the col↔status map
  // is lossy (won→Proposed→pitch, cancelled→Completed→completed) so status is
  // only sent when the column actually changed, and a blank/unchanged fee or
  // code never overwrites the stored value.
  async function submitEdit(input: ProjectFormSubmit) {
    try {
      await updateProject(project.id, {
        name: input.name,
        clientId: input.clientId,
        leadEmployeeId: input.leadEmployeeId ?? null,
        clientContactId: input.clientContactId ?? null,
        ...(input.code && input.code !== project.code ? { code: input.code } : {}),
        ...(input.col !== dbStatusToCol(project.dbStatus)
          ? { status: colToDbStatus(input.col) }
          : {}),
        ...(input.fee !== project.feePaise ? { feePaise: input.fee } : {}),
      });
      toast.success('Project updated.');
      setShowEdit(false);
      onEdited?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  }
  // A parent counts as linked when any of its sub-projects is (item 7).
  const linkedTotal =
    project.linkedInvoiceCount + subs.reduce((acc, s) => acc + s.linkedInvoiceCount, 0);
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
          {project.clientContactName ? (
            <>
              {' · POC '}
              {project.clientContactName}
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
            <span className="dot" style={{ background: tone.fg }} />
            {tone.label}
          </span>
          {linkedTotal === 0 ? (
            <span
              className="pill"
              title="No invoice or proforma linked to this project yet."
              style={{ background: 'rgba(208,138,30,0.14)', color: '#d08a1e' }}
            >
              <span className="dot" style={{ background: '#d08a1e' }} />
              Unlinked
            </span>
          ) : null}
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            DB state: {PROJECT_DB_STATUS_LABELS[project.dbStatus]}
          </span>
        </div>
      </div>
      {canEdit ? (
        <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn"
            type="button"
            title="Edit project details"
            onClick={() => setShowEdit(true)}
          >
            <Icon name="edit" size={13} />
            Edit
          </button>
          <ProjectStatusChanger
            projectId={project.id}
            value={project.dbStatus}
            onChanged={onStatusChanged}
          />
        </div>
      ) : null}
      {showEdit ? (
        <ProjectFormModal
          mode="edit"
          initial={{
            id: project.id,
            code: project.code,
            name: project.name,
            client: project.clientName,
            clientId: project.clientId,
            lead: initials(project.leadName),
            leadEmployeeId: project.leadEmployeeId,
            clientContactId: project.clientContactId,
            clientContactName: project.clientContactName,
            col: dbStatusToCol(project.dbStatus),
            fee: project.feePaise,
            parentProjectId: project.parentProjectId,
            subProjectCount: project.subProjectCount,
          }}
          defaultCol={dbStatusToCol(project.dbStatus)}
          onClose={() => setShowEdit(false)}
          onSubProjectsChanged={onEdited}
          onSubmit={(input) => void submitEdit(input)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewBody({
  project,
  feed,
  subs,
  receivedPaise,
  canEdit,
  onSubsChanged,
}: {
  project: Project;
  feed: Feed;
  subs: readonly ProjectListRow[];
  receivedPaise: bigint;
  canEdit: boolean;
  onSubsChanged: () => void;
}) {
  const net = feed.incomePaise - feed.spendPaise;
  const [showAddSub, setShowAddSub] = useState(false);
  const hasSubs = subs.length > 0;
  // Parent project value = Σ sub-project fees (display-computed, never
  // stored). Own fee still shown separately when set.
  const subTotal = subs.reduce((acc, s) => acc + s.feePaise, 0n);
  const isSubProject = Boolean(project.parentProjectId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi label="Received till now" value={formatINRPaise(receivedPaise)} tone="success" />
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
            ['POC (account manager)', project.clientContactName ?? '—'],
            ['Status', PROJECT_DB_STATUS_LABELS[project.dbStatus]],
            hasSubs
              ? ['Total (sub-projects)', formatINRPaise(subTotal)]
              : ['Fee', formatINRPaise(project.feePaise)],
            ...(hasSubs && project.feePaise > 0n
              ? [['Own fee', formatINRPaise(project.feePaise)] as [string, string]]
              : []),
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
      {!isSubProject ? (
        <OsCard title={`Sub-projects${hasSubs ? ` (${subs.length})` : ''}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hasSubs ? (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {subs.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                    onClick={() => navigateBesideFocused({ type: 'project', id: s.id })}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--os-font)',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {s.code ?? ''}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
                    {s.linkedInvoiceCount === 0 ? (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: 'rgba(208,138,30,0.14)',
                          color: '#d08a1e',
                        }}
                      >
                        Unlinked
                      </span>
                    ) : null}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {dbStatusToCol(s.status)}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatINRPaise(s.feePaise)}
                    </span>
                  </li>
                ))}
                <li
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    padding: '2px 10px 0',
                  }}
                >
                  Total: {formatINRPaise(subTotal)}
                </li>
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                No sub-projects. Each sub-project carries its own deliverables, fee and team; the
                parent&apos;s total is the sum of its sub-projects.
              </p>
            )}
            {canEdit ? (
              <div>
                <button className="btn" type="button" onClick={() => setShowAddSub(true)}>
                  <Icon name="plus" size={13} />
                  Add sub-project
                </button>
              </div>
            ) : null}
          </div>
        </OsCard>
      ) : null}
      {showAddSub ? (
        <ProjectFormModal
          mode="create"
          defaultCol="Proposed"
          parentProjectId={project.id}
          lockedClientId={project.clientId}
          onClose={() => setShowAddSub(false)}
          onSubmit={(input) => {
            void (async () => {
              try {
                await createProject({
                  clientId: input.clientId,
                  leadEmployeeId: input.leadEmployeeId,
                  accountManagerId: input.accountManagerId,
                  clientContactId: input.clientContactId,
                  parentProjectId: project.id,
                  name: input.name,
                  code: input.code || null,
                  status: colToDbStatus(input.col),
                  feePaise: input.fee,
                });
                toast.success('Sub-project created.');
                setShowAddSub(false);
                onSubsChanged();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Create failed');
              }
            })();
          }}
        />
      ) : null}
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

function TransactionsBody({
  project,
  feed,
  onRefresh,
}: {
  project: Project;
  feed: Feed;
  onRefresh: () => Promise<void>;
}) {
  const net = feed.incomePaise - feed.spendPaise;
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {feed.transactions.length} transaction{feed.transactions.length === 1 ? '' : 's'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="btn"
          type="button"
          title="Refresh transactions"
          aria-label="Refresh transactions"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <Icon name="refresh" size={13} />
        </button>
      </div>
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
        // Invoice rows open the invoice itself; other kinds open the plain
        // transaction window (postings + source document).
        onSelectTransaction={(t) => openTransactionOrInvoice(t.id, t.kind, t.reference)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

const INVOICE_STATE_LABEL: Record<ProjectInvoiceRow['state'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Deleted',
};

const INVOICE_STATE_COLOR: Record<ProjectInvoiceRow['state'], string> = {
  draft: 'var(--text-muted)',
  sent: '#5b8def',
  partially_paid: '#d08a1e',
  paid: '#2e8f5a',
  void: '#c46a28',
};

/**
 * Invoices linked to this project (header or per-line, sub-projects rolled
 * up). "New invoice" opens the shared composer pre-scoped to the project's
 * client with this project as the default; "Link existing…" attaches one of
 * the client's unattributed invoices via linkInvoiceToProject.
 */
function InvoicesBody({
  project,
  canEdit,
  onChanged,
}: {
  project: Project;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<readonly ProjectInvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Composer plumbing (themes / bank accounts / client readiness) — same
  // loads client-invoices-section does, scoped to this project's client.
  const [composerOpen, setComposerOpen] = useState(false);
  // Set when a DRAFT row is clicked — the composer opens it for edit/preview.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [themes, setThemes] = useState<InvoiceThemeSummary[]>([]);
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccountOption[]>([]);
  const [clientStateCode, setClientStateCode] = useState<string | null>(null);
  const [billingReady, setBillingReady] = useState<boolean | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listInvoicesForProject(project.id)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invoices');
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, reload]);

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    Promise.all([
      listInvoiceThemes().catch(() => []),
      listCompanyBankAccountOptions().catch(() => []),
      getClientBillingReadiness(project.clientId).catch(() => null),
    ]).then(([ths, banks, rdy]) => {
      if (cancelled) return;
      setThemes(ths);
      setBankAccounts(banks);
      setClientStateCode(rdy?.stateCode ?? null);
      setBillingReady(rdy?.ready ?? null);
      setMissing(rdy?.missing ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [canEdit, project.clientId]);

  function refresh() {
    setReload((k) => k + 1);
    onChanged();
  }

  if (error) {
    return <div style={{ fontSize: 13, color: 'var(--text-error, #c33)' }}>{error}</div>;
  }
  if (rows === null) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading invoices…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              if (billingReady === false) {
                toast.error(
                  `Add this client's ${missing.join(', ')} before generating an invoice.`,
                );
                return;
              }
              setEditingId(null);
              setComposerOpen(true);
            }}
          >
            <Icon name="plus" size={13} />
            New invoice
          </button>
          <button className="btn" type="button" onClick={() => setLinkOpen(true)}>
            Link existing…
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            New invoices default to this project; each line can point at a sub-project.
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          No invoice or proforma linked yet — this project is <strong>Unlinked</strong>. Attach a
          proforma early; convert it to a tax invoice when the engagement firms up.
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
          {rows.map((inv) => (
            <li
              key={inv.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: 13,
                cursor: 'pointer',
              }}
              title={
                inv.state === 'draft' && canEdit
                  ? `Open draft ${inv.documentNumber} in the composer`
                  : `Open invoice ${inv.documentNumber}`
              }
              onClick={() => {
                // Drafts open in the composer (edit/preview); finalized
                // invoices resolve to their stored PDF beside this window.
                if (inv.state === 'draft' && canEdit) {
                  setEditingId(inv.id);
                  setComposerOpen(true);
                  return;
                }
                void openInvoiceById(inv.id, inv.documentNumber);
              }}
            >
              <span style={{ fontFamily: 'var(--os-font)', fontVariantNumeric: 'tabular-nums' }}>
                {inv.documentNumber}
              </span>
              {inv.documentType === 'proforma' ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Proforma
                </span>
              ) : null}
              {inv.coveredUnderRetainer ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 999,
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Retainer
                </span>
              ) : null}
              {inv.linkedVia !== 'header' ? (
                <span
                  title="Linked through line-item project tags"
                  style={{ fontSize: 10.5, color: 'var(--text-muted)' }}
                >
                  via line items
                </span>
              ) : null}
              <span style={{ flex: 1, minWidth: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {inv.convertedFromNumber ? `from ${inv.convertedFromNumber} · ` : ''}
                {inv.convertedToNumber ? `→ ${inv.convertedToNumber} · ` : ''}
                {inv.documentDate}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: INVOICE_STATE_COLOR[inv.state],
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {INVOICE_STATE_LABEL[inv.state]}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatINRPaise(inv.capturedTotalPaise)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <InvoiceComposerDialog
          open={composerOpen}
          onOpenChange={(open) => {
            setComposerOpen(open);
            if (!open) setEditingId(null);
          }}
          clientId={project.clientId}
          clientName={project.clientName}
          clientStateCode={clientStateCode}
          themes={themes}
          defaultThemeId={themes.find((t) => t.isDefault)?.id ?? null}
          bankAccounts={bankAccounts}
          defaultProjectId={project.id}
          existingInvoiceId={editingId}
          onFinalized={refresh}
        />
      ) : null}

      {linkOpen ? (
        <LinkInvoiceDialog
          clientId={project.clientId}
          projectId={project.id}
          projectName={project.name}
          onClose={() => setLinkOpen(false)}
          onLinked={() => {
            setLinkOpen(false);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** Pick one of the client's unattributed invoices and link it to the project. */
function LinkInvoiceDialog({
  clientId,
  projectId,
  projectName,
  onClose,
  onLinked,
}: {
  clientId: string;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [candidates, setCandidates] = useState<ReadonlyArray<{
    id: string;
    documentNumber: string;
    documentType: 'invoice' | 'proforma';
    documentDate: string;
    state: string;
    capturedTotalPaise: bigint;
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listUnattributedInvoicesForClient(clientId)
      .then((rows) => {
        if (!cancelled) setCandidates(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invoices');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  async function link(invoiceId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await linkInvoiceToProject(invoiceId, projectId);
      toast.success('Invoice linked to the project.');
      onLinked();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not link the invoice');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Link an invoice to ${projectName}`} onClose={onClose} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Showing this client&apos;s invoices with no project attribution (header or lines). Linking
          sets the invoice&apos;s default project — line-level tags can refine it later.
        </p>
        {error ? (
          <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div>
        ) : null}
        {candidates === null ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading…</p>
        ) : candidates.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Every invoice for this client is already attributed to a project.
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
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            {candidates.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ fontFamily: 'var(--os-font)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.documentNumber}
                </span>
                {c.documentType === 'proforma' ? (
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Proforma</span>
                ) : null}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.documentDate}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatINRPaise(c.capturedTotalPaise)}
                </span>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void link(c.id)}
                  disabled={busy}
                >
                  Link
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Team                                                                        */
/* -------------------------------------------------------------------------- */

function TeamBody({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [members, setMembers] = useState<readonly ProjectMemberRow[]>([]);
  const [employees, setEmployees] = useState<readonly EmployeeOption[]>([]);
  const [vendorLinks, setVendorLinks] = useState<readonly ProjectVendorRow[]>([]);
  const [vendorOptions, setVendorOptions] = useState<readonly VendorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    Promise.all([
      listProjectMembers(projectId),
      listEmployees(),
      listProjectVendors(projectId),
      // Picker options only — archived vendors are excluded by default.
      listVendors().catch(() => []),
    ])
      .then(([m, emps, pv, vs]) => {
        if (cancelled) return;
        setMembers(m);
        setEmployees(emps.map((e) => ({ id: e.id, name: e.fullName })));
        setVendorLinks(pv);
        setVendorOptions(vs.map((v) => ({ id: v.id, name: v.name })));
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
  const linkedVendorIds = new Set(vendorLinks.map((v) => v.vendorId));
  const availableVendors = vendorOptions.filter((v) => !linkedVendorIds.has(v.id));

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

  async function addVendors(vendorIds: readonly string[], role: string) {
    if (vendorIds.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await Promise.all(
        vendorIds.map((vendorId) => addProjectVendor({ projectId, vendorId, role: role || null })),
      );
      setVendorLinks((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        const merged = [...prev, ...rows.filter((r) => !seen.has(r.id))];
        return merged.sort((a, b) => a.vendorName.localeCompare(b.vendorName));
      });
      setVendorPickerOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add vendors');
    } finally {
      setBusy(false);
    }
  }

  async function removeVendor(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeProjectVendor({ id });
      setVendorLinks((prev) => prev.filter((v) => v.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove vendor');
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
            title={
              available.length === 0 ? 'Every employee is already on this project.' : undefined
            }
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

      {/* Vendors — supplier-side counterpart of the members list (§4.3). */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderTop: '1px solid var(--border)',
          paddingTop: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            Vendors{vendorLinks.length > 0 ? ` (${vendorLinks.length})` : ''}
          </h3>
          <div style={{ flex: 1 }} />
          {canEdit ? (
            <button
              className="btn"
              type="button"
              onClick={() => setVendorPickerOpen(true)}
              disabled={busy || availableVendors.length === 0}
              title={
                availableVendors.length === 0
                  ? 'Every vendor is already on this project.'
                  : undefined
              }
            >
              <Icon name="plus" size={13} />
              Add vendor
            </button>
          ) : null}
        </div>

        {vendorLinks.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No vendors attached to this project yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {vendorLinks.map((v) => (
              <span
                key={v.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  fontSize: 12.5,
                }}
              >
                <EntityRef
                  type="vendor"
                  id={v.vendorId}
                  label={v.vendorName}
                  hideIcon
                  onNavigate={navigateBesideFocused}
                />
                {v.role ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v.role}</span>
                ) : null}
                {canEdit ? (
                  <button
                    className="btn row-action row-delete"
                    type="button"
                    title="Remove vendor"
                    onClick={() => void removeVendor(v.id)}
                    disabled={busy}
                  >
                    <Icon name="close" size={11} />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>

      {vendorPickerOpen ? (
        <AddVendorsDialog
          available={availableVendors}
          busy={busy}
          onCancel={() => setVendorPickerOpen(false)}
          onAdd={(ids, role) => void addVendors(ids, role)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Add vendor" popup — multi-select over the vendors not yet on the project,
 * same os-modal chrome + checkbox-list pattern as AddTeamMatesDialog, plus an
 * optional free-text role applied to everyone being added.
 */
function AddVendorsDialog({
  available,
  busy,
  onCancel,
  onAdd,
}: {
  available: readonly VendorOption[];
  busy: boolean;
  onCancel: () => void;
  onAdd: (vendorIds: readonly string[], role: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const q = query.trim().toLowerCase();
  const filtered = q ? available.filter((v) => v.name.toLowerCase().includes(q)) : available;

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
            Add vendors
          </div>
          <button className="btn" type="button" onClick={onCancel} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="os-modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
            <input
              className="input"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors…"
            />

            {filtered.length === 0 ? (
              <p
                style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, padding: '8px 2px' }}
              >
                {available.length === 0
                  ? 'Every vendor is already on this project.'
                  : `No vendors match “${query}”.`}
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
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {filtered.map((v) => (
                  <li key={v.id}>
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
                        background: selected.has(v.id) ? 'var(--hover)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(v.id)}
                        onChange={() => toggle(v.id)}
                        style={{ accentColor: 'var(--accent, #4a72ff)' }}
                      />
                      <span style={{ flex: 1 }}>{v.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <input
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Role (optional), e.g. printer — applies to everyone added"
            />

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
                onClick={() => onAdd([...selected], role.trim())}
                disabled={busy || selected.size === 0}
              >
                <Icon name="plus" size={13} />
                {busy
                  ? 'Adding…'
                  : selected.size === 0
                    ? 'Add vendors'
                    : `Add ${selected.size} vendor${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
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
              <p
                style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, padding: '8px 2px' }}
              >
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

// Eisenhower priority tags (0070). Chip colour doubles as the select label
// colour cue: red → orange → blue → gray, hottest first.
const TASK_PRIORITIES: ReadonlyArray<{
  value: ProjectTaskPriority;
  label: string;
  color: string;
}> = [
  { value: 'urgent_important', label: 'Urgent & Important', color: '#e5484d' },
  { value: 'urgent', label: 'Urgent', color: '#f76b15' },
  { value: 'important', label: 'Important', color: '#3b82f6' },
  { value: 'nice', label: 'Nice / Not right now', color: '#8b8d98' },
];

const TASK_SOURCES: ReadonlyArray<{ value: ProjectTaskSource; label: string; short: string }> = [
  { value: 'apar', label: 'From Apar', short: 'Apar' },
  { value: 'vendor', label: 'From Vendor', short: 'Vendor' },
];

// Display order within a group: urgent_important → urgent → important →
// no priority → nice, then the existing position order (sort is stable, so
// equal ranks keep the server's position/createdAt ordering).
const TASK_PRIORITY_RANK: Record<ProjectTaskPriority, number> = {
  urgent_important: 0,
  urgent: 1,
  important: 2,
  nice: 4,
};

function taskPriorityRank(priority: ProjectTaskPriority | null): number {
  return priority ? TASK_PRIORITY_RANK[priority] : 3;
}

function compareTasks(a: ProjectTaskRow, b: ProjectTaskRow): number {
  return taskPriorityRank(a.priority) - taskPriorityRank(b.priority) || a.position - b.position;
}

function TasksBody({
  projectId,
  canEdit,
  subProjects = [],
  parentName,
}: {
  projectId: string;
  canEdit: boolean;
  /** When present, deliverables are grouped by sub-project (item request). */
  subProjects?: readonly { id: string; name: string; code: string | null }[];
  parentName: string;
}) {
  const [tasks, setTasks] = useState<readonly ProjectTaskRow[]>([]);
  // Assignee options are the project's TEAM (project_members), not the whole
  // employee directory — only people on the project can pick up deliverables.
  // Carries each member's department so the picker can group by it (0073).
  const [team, setTeam] = useState<readonly AssigneeOption[]>([]);
  // Vendor-sourced deliverables assign to the project's vendors (0072/0073).
  const [vendors, setVendors] = useState<readonly VendorOption[]>([]);
  const [categories, setCategories] = useState<readonly DeliverableCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manageCats, setManageCats] = useState(false);

  // Add-deliverable inline form state. Due date starts at today — the common
  // case — and stays editable. Multiple assignees via the picker dialog.
  const [title, setTitle] = useState('');
  const [draftAssignees, setDraftAssignees] = useState<readonly string[]>([]);
  const [draftVendorAssignees, setDraftVendorAssignees] = useState<readonly string[]>([]);
  const [draftCategoryId, setDraftCategoryId] = useState('');
  const [draftPriority, setDraftPriority] = useState(''); // '' = no priority
  const [draftSource, setDraftSource] = useState<ProjectTaskSource>('apar');
  const [dueOn, setDueOn] = useState(todayISODate());
  const [pickerFor, setPickerFor] = useState<'draft' | string | null>(null);

  // Grouping: when the project has sub-projects, show a heading per project
  // (this project first, then each sub-project) and let new deliverables target
  // any of them. `subKey` keeps the fetch effect stable across renders.
  const grouped = subProjects.length > 0;
  const targets: readonly { id: string; name: string; code: string | null }[] = [
    { id: projectId, name: parentName, code: null },
    ...subProjects,
  ];
  const subKey = subProjects.map((sp) => sp.id).join(',');
  const [addTargetId, setAddTargetId] = useState<string>(projectId);

  async function reloadCategories() {
    try {
      setCategories(await listDeliverableCategories());
    } catch {
      /* non-fatal — picker just stays stale */
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    const ids = [projectId, ...subProjects.map((sp) => sp.id)];
    Promise.all([
      Promise.all(ids.map((id) => listProjectTasks(id))).then((g) => g.flat()),
      Promise.all(ids.map((id) => listProjectMembers(id).catch(() => []))).then((g) => g.flat()),
      Promise.all(ids.map((id) => listProjectVendors(id).catch(() => []))).then((g) => g.flat()),
      listDeliverableCategories(),
    ])
      .then(([t, members, projVendors, cats]) => {
        if (cancelled) return;
        setTasks(t);
        // Union the team across the parent + sub-projects for the assignee
        // picker, keeping each member's department for grouping.
        const uniq = new Map(
          members.map((m) => [m.employeeId, { name: m.employeeName, department: m.department }]),
        );
        setTeam([...uniq].map(([id, v]) => ({ id, name: v.name, department: v.department })));
        // Union the project vendors likewise (deduped by vendor id).
        const uniqV = new Map(projVendors.map((v) => [v.vendorId, v.vendorName]));
        setVendors([...uniqV].map(([id, name]) => ({ id, name })));
        setCategories(cats);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load deliverables');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // subKey is the stable proxy for the subProjects array (which changes identity each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, subKey]);

  // A deliverable may still include someone who has since left the team; keep
  // those people visible in its picker so the selection doesn't misrender.
  function employeeOptionsFor(task?: ProjectTaskRow): readonly AssigneeOption[] {
    if (!task) return team;
    const extra = task.assignees
      .filter(
        (a) => a.kind === 'employee' && a.employeeId && !team.some((m) => m.id === a.employeeId),
      )
      .map((a) => ({
        id: a.employeeId as string,
        name: `${a.name} (not on team)`,
        department: null,
      }));
    return extra.length > 0 ? [...team, ...extra] : team;
  }

  // Likewise for vendors that have since been unlinked from the project.
  function vendorOptionsFor(task?: ProjectTaskRow): readonly AssigneeOption[] {
    if (!task) return vendors;
    const extra = task.assignees
      .filter((a) => a.kind === 'vendor' && a.vendorId && !vendors.some((v) => v.id === a.vendorId))
      .map((a) => ({ id: a.vendorId as string, name: `${a.name} (not on project)` }));
    return extra.length > 0 ? [...vendors, ...extra] : vendors;
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
      // Source decides which kind of assignee the deliverable carries: a
      // vendor-sourced deliverable gets its vendor picks, an apar one gets its
      // employee picks (0073).
      const row = await createProjectTask({
        projectId: grouped ? addTargetId : projectId,
        title: t,
        assigneeEmployeeIds: draftSource === 'vendor' ? [] : [...draftAssignees],
        assigneeVendorIds: draftSource === 'vendor' ? [...draftVendorAssignees] : [],
        categoryId: draftCategoryId || null,
        priority: draftPriority ? (draftPriority as ProjectTaskPriority) : null,
        source: draftSource,
        dueOn: dueOn || null,
      });
      setTasks((prev) => [...prev, row]);
      setTitle('');
      setDraftAssignees([]);
      setDraftVendorAssignees([]);
      setDraftCategoryId('');
      setDraftPriority('');
      setDraftSource('apar');
      setDueOn(todayISODate());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add deliverable');
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
      setError(e instanceof Error ? e.message : 'Failed to update deliverable');
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignees(id: string, mode: 'employee' | 'vendor', ids: readonly string[]) {
    setBusy(true);
    setError(null);
    try {
      // Only the picked kind is sent — the other kind is left untouched (0073).
      const row = await updateProjectTask(
        mode === 'vendor'
          ? { id, assigneeVendorIds: [...ids] }
          : { id, assigneeEmployeeIds: [...ids] },
      );
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update deliverable');
    } finally {
      setBusy(false);
    }
  }

  async function changeCategory(id: string, categoryId: string) {
    setBusy(true);
    setError(null);
    try {
      const row = await updateProjectTask({ id, categoryId: categoryId || null });
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update deliverable');
    } finally {
      setBusy(false);
    }
  }

  async function changePriority(id: string, priority: string) {
    setBusy(true);
    setError(null);
    try {
      const row = await updateProjectTask({
        id,
        priority: priority ? (priority as ProjectTaskPriority) : null,
      });
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update deliverable');
    } finally {
      setBusy(false);
    }
  }

  async function changeSource(id: string, source: string) {
    setBusy(true);
    setError(null);
    try {
      const row = await updateProjectTask({
        id,
        source: source ? (source as ProjectTaskSource) : null,
      });
      replaceTask(row);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update deliverable');
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
      setError(e instanceof Error ? e.message : 'Failed to delete deliverable');
    } finally {
      setBusy(false);
    }
  }

  function assigneeSummary(assignees: readonly ProjectTaskAssignee[]): string {
    if (assignees.length === 0) return 'Unassigned';
    if (assignees.length === 1) {
      const a = assignees[0]!;
      return a.kind === 'vendor' ? `${a.name} (vendor)` : a.name;
    }
    if (assignees.length === 2)
      return `${firstName(assignees[0]!.name)}, ${firstName(assignees[1]!.name)}`;
    return `${firstName(assignees[0]!.name)} +${assignees.length - 1}`;
  }

  if (loading) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading deliverables…</p>
    );
  }

  const pickerTask =
    pickerFor && pickerFor !== 'draft' ? tasks.find((t) => t.id === pickerFor) : null;

  const renderTask = (t: ProjectTaskRow) => {
    const done = t.status === 'done';
    const priority = t.priority ? TASK_PRIORITIES.find((p) => p.value === t.priority) : undefined;
    const source = t.source ? TASK_SOURCES.find((s) => s.value === t.source) : undefined;
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
          {priority ? (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                border: `1px solid ${priority.color}`,
                color: priority.color,
                whiteSpace: 'nowrap',
              }}
            >
              {priority.label}
            </span>
          ) : null}
          {t.categoryName ? (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                border: `1px solid ${t.categoryColor ?? 'var(--border)'}`,
                color: t.categoryColor ?? 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {t.categoryName}
            </span>
          ) : null}
          {source ? (
            <span
              title={source.label}
              style={{
                marginLeft: 8,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 7px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {source.short}
            </span>
          ) : null}
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
            <button
              className="btn"
              type="button"
              onClick={() => setPickerFor(t.id)}
              disabled={busy}
              title={
                t.assignees.length > 0 ? t.assignees.map((a) => a.name).join(', ') : 'Assign people'
              }
              style={{ fontSize: 12 }}
            >
              <Icon name="users" size={12} />
              {assigneeSummary(t.assignees)}
            </button>
            <select
              className="input"
              value={t.categoryId ?? ''}
              onChange={(e) => void changeCategory(t.id, e.target.value)}
              disabled={busy}
              title="Category"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {t.categoryId && !categories.some((c) => c.id === t.categoryId) ? (
                <option value={t.categoryId}>{t.categoryName ?? 'Archived category'}</option>
              ) : null}
            </select>
            <select
              className="input"
              value={t.priority ?? ''}
              onChange={(e) => void changePriority(t.id, e.target.value)}
              disabled={busy}
              title="Priority (Eisenhower)"
            >
              <option value="">No priority</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={t.source ?? ''}
              onChange={(e) => void changeSource(t.id, e.target.value)}
              disabled={busy}
              title="Source — who this deliverable comes from"
            >
              <option value="">No source</option>
              {TASK_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
              title="Delete deliverable"
              onClick={() => void remove(t.id)}
              disabled={busy}
            >
              <Icon name="trash" size={13} />
            </button>
          </>
        ) : (
          <>
            {t.assignees.length > 0 ? (
              <span
                style={{ fontSize: 11, color: 'var(--text-muted)' }}
                title={t.assignees.map((a) => a.name).join(', ')}
              >
                {assigneeSummary(t.assignees)}
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
  };

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
            placeholder="New deliverable…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTask();
              }
            }}
          />
          {grouped ? (
            <select
              className="input"
              value={addTargetId}
              onChange={(e) => setAddTargetId(e.target.value)}
              title="Which project this deliverable belongs to"
            >
              {targets.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.id === projectId
                    ? `${tg.name} (parent)`
                    : `${tg.code ? tg.code + ' · ' : ''}${tg.name}`}
                </option>
              ))}
            </select>
          ) : null}
          <button
            className="btn"
            type="button"
            onClick={() => setPickerFor('draft')}
            title={
              draftSource === 'vendor'
                ? vendors.length === 0
                  ? 'Add vendors in the Team tab to assign this deliverable.'
                  : 'Pick one or more vendors for this deliverable'
                : team.length === 0
                  ? 'Add team mates in the Team tab to assign deliverables.'
                  : 'Pick one or more people for this deliverable'
            }
          >
            <Icon name="users" size={13} />
            {(() => {
              const n =
                draftSource === 'vendor' ? draftVendorAssignees.length : draftAssignees.length;
              return n === 0 ? 'Assignees' : `${n} assignee${n === 1 ? '' : 's'}`;
            })()}
          </button>
          <select
            className="input"
            value={draftCategoryId}
            onChange={(e) => setDraftCategoryId(e.target.value)}
            title="Category (applies across all projects)"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={draftPriority}
            onChange={(e) => setDraftPriority(e.target.value)}
            title="Priority (Eisenhower — optional)"
          >
            <option value="">No priority</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={draftSource}
            onChange={(e) => setDraftSource(e.target.value as ProjectTaskSource)}
            title="Source — who this deliverable comes from"
          >
            {TASK_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <DateField
            value={dueOn}
            onChange={(next) => setDueOn(next)}
            placeholder="Due date (optional)"
            className="w-[150px]"
          />
          <button
            className="btn primary"
            type="button"
            onClick={() => void addTask()}
            disabled={busy || title.trim().length === 0}
          >
            <Icon name="plus" size={13} />
            Add deliverable
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setManageCats(true)}
            title="Create, rename or archive the global deliverable categories."
          >
            Manage categories
          </button>
        </div>
      ) : null}

      {error ? <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div> : null}

      {tasks.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No deliverables yet.</p>
      ) : grouped ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {targets.map((tg) => {
            const groupTasks = tasks
              .filter((t) => t.projectId === tg.id)
              .slice()
              .sort(compareTasks);
            return (
              <div key={tg.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 2px',
                  }}
                >
                  <span>
                    {tg.id === projectId
                      ? `${tg.name} · parent`
                      : `${tg.code ? tg.code + ' \u00b7 ' : ''}${tg.name}`}
                  </span>
                  <span style={{ fontWeight: 500 }}>{groupTasks.length}</span>
                </div>
                {groupTasks.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 2px' }}>
                    No deliverables here yet.
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
                    {groupTasks.map(renderTask)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
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
          {tasks.slice().sort(compareTasks).map(renderTask)}
        </ul>
      )}

      {pickerFor
        ? (() => {
            // Source decides the picker's flavour: 'vendor' deliverables assign
            // to project vendors; everything else (apar / untagged) to team
            // members grouped by department (0073).
            const isDraft = pickerFor === 'draft';
            const source = isDraft ? draftSource : (pickerTask?.source ?? 'apar');
            const mode: 'employee' | 'vendor' = source === 'vendor' ? 'vendor' : 'employee';

            const options =
              mode === 'vendor'
                ? isDraft
                  ? vendors
                  : vendorOptionsFor(pickerTask ?? undefined)
                : isDraft
                  ? team
                  : employeeOptionsFor(pickerTask ?? undefined);

            const initial = isDraft
              ? mode === 'vendor'
                ? draftVendorAssignees
                : draftAssignees
              : (pickerTask?.assignees
                  .filter((a) => (mode === 'vendor' ? a.kind === 'vendor' : a.kind === 'employee'))
                  .map((a) => (mode === 'vendor' ? a.vendorId : a.employeeId))
                  .filter((id): id is string => !!id) ?? []);

            return (
              <AssigneePickerDialog
                mode={mode}
                options={options}
                initial={initial}
                busy={busy}
                onCancel={() => setPickerFor(null)}
                onSave={(ids) => {
                  if (isDraft) {
                    if (mode === 'vendor') setDraftVendorAssignees(ids);
                    else setDraftAssignees(ids);
                    setPickerFor(null);
                  } else {
                    const id = pickerFor;
                    setPickerFor(null);
                    void changeAssignees(id, mode, ids);
                  }
                }}
              />
            );
          })()
        : null}

      {manageCats ? (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setManageCats(false)}
          onChanged={() => void reloadCategories()}
        />
      ) : null}
    </div>
  );
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

const NO_DEPARTMENT = 'No department';

/** Department bucket key for grouping/filtering — null/blank → "No department". */
function departmentKey(dept?: string | null): string {
  return dept && dept.trim() ? dept.trim() : NO_DEPARTMENT;
}

/**
 * Multi-select assignee picker (0073). Returns the full replacement set
 * (deliverables use per-kind replace-set semantics server-side).
 *
 * `mode` is driven by the deliverable's source: 'employee' offers the project
 * team grouped by department, with a live search box and a department filter;
 * 'vendor' offers the project's vendors as a flat, searchable list (vendors
 * carry no department, so there is no grouping/filter UI).
 */
function AssigneePickerDialog({
  mode,
  options,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  mode: 'employee' | 'vendor';
  options: readonly AssigneeOption[];
  initial: readonly string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (ids: readonly string[]) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(initial));
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState(''); // '' = all departments

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isVendor = mode === 'vendor';
  const q = search.trim().toLowerCase();

  // Distinct departments present (employee mode only), "No department" last.
  const departments = isVendor
    ? []
    : [...new Set(options.map((o) => departmentKey(o.department)))].sort((a, b) => {
        if (a === NO_DEPARTMENT) return 1;
        if (b === NO_DEPARTMENT) return -1;
        return a.localeCompare(b);
      });

  const filtered = options.filter(
    (o) =>
      (q === '' || o.name.toLowerCase().includes(q)) &&
      (isVendor || deptFilter === '' || departmentKey(o.department) === deptFilter),
  );

  // Group the filtered options by department (employee mode).
  const groups = new Map<string, AssigneeOption[]>();
  if (!isVendor) {
    for (const o of filtered) {
      const k = departmentKey(o.department);
      const arr = groups.get(k) ?? [];
      arr.push(o);
      groups.set(k, arr);
    }
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    if (a === NO_DEPARTMENT) return 1;
    if (b === NO_DEPARTMENT) return -1;
    return a.localeCompare(b);
  });

  const renderOption = (o: AssigneeOption) => (
    <li key={o.id}>
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
          background: selected.has(o.id) ? 'var(--hover)' : 'transparent',
        }}
      >
        <input
          type="checkbox"
          checked={selected.has(o.id)}
          onChange={() => toggle(o.id)}
          style={{ accentColor: 'var(--apar-red, #e63a1f)' }}
        />
        <span style={{ flex: 1 }}>{o.name}</span>
      </label>
    </li>
  );

  const listStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    listStyle: 'none' as const,
    padding: 0,
    margin: 0,
  };

  return (
    <Modal title={isVendor ? 'Vendor assignees' : 'Assignees'} onClose={onCancel} width={400}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
        {options.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            {isVendor
              ? 'No vendors on this project — add them in the Team tab.'
              : 'No team mates yet — add people in the Team tab first.'}
          </p>
        ) : (
          <>
            {/* Search + (employee-only) department filter */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 160px' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                  }}
                >
                  <Icon name="search" size={13} />
                </span>
                <input
                  className="input"
                  style={{ width: '100%', paddingLeft: 28 }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={isVendor ? 'Search vendors…' : 'Search people…'}
                  autoFocus
                />
              </div>
              {!isVendor && departments.length > 1 ? (
                <select
                  className="input"
                  style={{ flex: '0 1 150px' }}
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  title="Filter by department"
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {filtered.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '6px 2px' }}>
                  No matches.
                </p>
              ) : isVendor ? (
                <ul style={listStyle}>{filtered.map(renderOption)}</ul>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {groupKeys.map((k) => (
                    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          padding: '2px 2px',
                        }}
                      >
                        {k}
                      </div>
                      <ul style={listStyle}>{groups.get(k)!.map(renderOption)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
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
            onClick={() => onSave([...selected])}
            disabled={busy}
          >
            <Icon name="check" size={13} />
            Save assignees
          </button>
        </div>
      </div>
    </Modal>
  );
}

const CATEGORY_SWATCHES = [
  '#e63a1f',
  '#3F4E8E',
  '#2D8A8A',
  '#5E7344',
  '#7A2D4E',
  '#7A4E2D',
  '#d08a1e',
] as const;

/**
 * Global deliverable-category manager. Categories apply to deliverables in
 * ALL projects (item 6) — create, archive; archive detaches live rows.
 */
function CategoryManagerModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: readonly DeliverableCategoryRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CATEGORY_SWATCHES[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createDeliverableCategory({ name: n, color });
      setName('');
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create category');
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await archiveDeliverableCategory(id);
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to archive category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Deliverable categories" onClose={onClose} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Categories are global — they apply to deliverables across all projects.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New category name…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {CATEGORY_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: c,
                  border: color === c ? '2px solid var(--text)' : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>
          <button
            className="btn primary"
            type="button"
            onClick={() => void create()}
            disabled={busy || name.trim().length === 0}
          >
            <Icon name="plus" size={13} />
            Add
          </button>
        </div>
        {error ? (
          <div style={{ fontSize: 12, color: 'var(--text-error, #c33)' }}>{error}</div>
        ) : null}
        {categories.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No categories yet.</p>
        ) : (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              listStyle: 'none',
              padding: 0,
              margin: 0,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {categories.map((c) => (
              <li
                key={c.id}
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
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: c.color ?? 'var(--border)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {c.usageCount} in use
                </span>
                <button
                  className="btn row-action row-delete"
                  type="button"
                  title={
                    c.usageCount > 0
                      ? 'Archiving detaches this category from its deliverables.'
                      : 'Archive category'
                  }
                  onClick={() => void archive(c.id)}
                  disabled={busy}
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
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
