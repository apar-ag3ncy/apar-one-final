'use client';

// OS client profile window. Uses the same chrome pattern as the legacy
// ClientDetail in apps.tsx (custom header + .tabs / .tab tab bar + OS
// palette via CSS variables) so the OS theme is preserved. The new
// Section components from `components/entity/` provide the functional
// content inside each tab.

import { useEffect, useState, type ReactNode } from 'react';

import { ContactsSection } from '@/components/entity/contacts-section';
import { AddressesSection } from '@/components/entity/addresses-section';
import { BankAccountsSection } from '@/components/entity/bank-accounts-section';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { ClientEditDialog } from './client-edit-dialog';
import { DocumentsSection } from '@/components/entity/documents-section';
import { ClientInvoicesSection } from '@/components/entity/client-invoices-section';
import { ClientPaymentsSection } from '@/components/entity/client-payments-section';
import { ClientExpensesOnBehalfSection } from '@/components/entity/vendor-bills-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { StatementOfAccount } from '@/components/entity/statement-of-account';
import {
  NewProjectDialog,
  type EmployeeOption,
  type UserOption,
} from '@/components/projects/new-project-dialog';
import type { Project, ProjectStatus } from '@/components/projects/types';
import { useEntityMutation } from '../auth/entity-mutation-gate';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import { getClientStatement, type Statement } from '@/lib/server/ledger/statements';
import {
  getClientOverviewStats,
  type ClientOverviewStats,
} from '@/lib/server/billing/client-receipts';
import {
  getClient,
  listEmployees,
  listProjectsByClient,
  listUsers,
  resolveDocumentUrl,
} from '@/lib/server-stub/entity-actions';
import type { Client } from '@/components/clients/types';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';
import {
  openDocumentWindow,
  openInvoiceForTransaction,
  openTransactionOrInvoice,
} from './open-invoice';

export type ClientWindowProps = {
  clientId: string;
  onClose?: () => void;
};

type ClientTab =
  | 'overview'
  | 'contacts'
  | 'addresses'
  | 'bank'
  | 'projects'
  | 'documents'
  | 'invoices'
  | 'transactions'
  | 'expenses'
  | 'ledger'
  | 'activity'
  | 'settings';

const TAB_LABELS: Record<ClientTab, string> = {
  overview: 'Overview',
  contacts: 'Contacts',
  addresses: 'Addresses',
  bank: 'Bank accounts',
  projects: 'Projects',
  documents: 'Documents',
  invoices: 'Invoices',
  transactions: 'Transactions',
  expenses: 'Expenses on behalf',
  ledger: 'Ledger',
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

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#1f6b3b', fg: '#a4d8b3' },
  onboarding: { bg: '#7a5a17', fg: '#e7c980' },
  inactive: { bg: '#3a3a3a', fg: '#bdbdbd' },
  archived: { bg: '#3a3a3a', fg: '#bdbdbd' },
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      client: Client;
      contacts: readonly ContactRow[];
      projects: readonly Project[];
      employees: readonly EmployeeOption[];
      users: readonly UserOption[];
    };

export function ClientWindow({ clientId, onClose }: ClientWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<ClientTab>('overview');
  const [reloadKey, setReloadKey] = useState(0);
  // Signed URL for the client's logo (short-lived; refreshed on each load).
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  // OS edit grant for the clients app (provided by os-root's EntityMutationGate).
  const { canEdit } = useEntityMutation();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ kind: 'loading' });
    });
    Promise.all([
      getClient(clientId),
      listContacts({ entityType: 'client', entityId: clientId }),
      listProjectsByClient(clientId),
      listEmployees(),
      listUsers(),
    ])
      .then(([client, contacts, projects, employees, users]) => {
        if (cancelled) return;
        if (!client) {
          setState({
            kind: 'error',
            message: `Client ${clientId} not found.`,
          });
          return;
        }
        setState({
          kind: 'ready',
          client,
          contacts,
          projects,
          employees: employees.map((e) => ({ id: e.id, name: e.fullName })),
          users: users.map((u) => ({ id: u.id, name: u.fullName })),
        });
        if (client.logoDocumentId) {
          resolveDocumentUrl(client.logoDocumentId)
            .then((r) => {
              if (!cancelled) setLogoUrl(r.url);
            })
            .catch(() => {});
        } else {
          setLogoUrl(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load client',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, reloadKey]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading client…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--text-error, #c33)' }}>{state.message}</div>;
  }

  const { client, contacts, projects, employees, users } = state;
  const tabs: readonly ClientTab[] = [
    'overview',
    'contacts',
    'addresses',
    'bank',
    'projects',
    'documents',
    'invoices',
    'transactions',
    'expenses',
    'ledger',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header
        client={client}
        logoUrl={logoUrl}
        actions={
          canEdit ? (
            <ClientEditDialog client={client} onSaved={() => setReloadKey((k) => k + 1)} />
          ) : undefined
        }
      />
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
            {t === 'projects' && projects.length > 0 ? (
              <span style={{ marginLeft: 6, opacity: 0.7 }}>{projects.length}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? (
          <OverviewBody
            client={client}
            contacts={contacts}
            projects={projects}
            onOpenTab={setTab}
          />
        ) : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="client"
            entityId={client.id}
            entityName={client.name}
            initial={contacts}
          />
        ) : null}
        {tab === 'addresses' ? (
          <AddressesSection entityType="client" entityId={client.id} entityName={client.name} />
        ) : null}
        {tab === 'bank' ? (
          <BankAccountsSection entityType="client" entityId={client.id} entityName={client.name} />
        ) : null}
        {tab === 'projects' ? (
          <ProjectsBody
            client={client}
            projects={projects}
            employees={employees}
            users={users}
            onProjectCreated={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'documents' ? (
          <DocumentsSection
            entityType="client"
            entityId={client.id}
            entityName={client.name}
            onUploaded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'invoices' ? (
          <ClientInvoicesSection
            clientId={client.id}
            clientName={client.name}
            onOpenInvoice={openDocumentWindow}
          />
        ) : null}
        {tab === 'transactions' ? (
          <ClientPaymentsSection
            clientId={client.id}
            clientName={client.name}
            onOpenInvoice={(invoiceTxnId, documentNumber) =>
              void openInvoiceForTransaction(invoiceTxnId, documentNumber)
            }
          />
        ) : null}
        {tab === 'expenses' ? (
          <ClientExpensesOnBehalfSection clientId={client.id} clientName={client.name} />
        ) : null}
        {tab === 'ledger' ? <ClientLedgerBody clientId={client.id} /> : null}
        {tab === 'activity' ? <ActivityBody clientId={client.id} /> : null}
        {tab === 'settings' ? (
          <div style={{ display: 'grid', gap: 24 }}>
            <EntitySettingsSection
              kind="client"
              entityId={client.id}
              entityName={client.name}
              isArchived={client.status === 'archived'}
              onChanged={() => setReloadKey((k) => k + 1)}
              onDeleted={onClose}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Projects (OS-styled list + "New Project" CTA)                              */
/* -------------------------------------------------------------------------- */

function ProjectsBody({
  client,
  projects,
  employees,
  users,
  onProjectCreated,
}: {
  client: Client;
  projects: readonly Project[];
  employees: readonly EmployeeOption[];
  users: readonly UserOption[];
  onProjectCreated: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Composing a project is an edit on the clients app.
  const { canEdit } = useEntityMutation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {projects.length === 0
            ? 'No projects yet'
            : `${projects.length} project${projects.length === 1 ? '' : 's'} for ${client.name}`}
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            style={{
              background: 'var(--accent, #4a72ff)',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            New Project
          </button>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <div
          style={{
            background: 'var(--content-2)',
            border: '1px dashed var(--border)',
            borderRadius: 10,
            padding: 32,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Create the first project for {client.name}. Pitches, active engagements, and closed work
          all live here.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--content-2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--content-1, rgba(0,0,0,0.15))' }}>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th>Lead</Th>
                <Th>POC</Th>
                <Th align="right">Fee</Th>
                <Th>Started</Th>
                <Th>Target end</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const tone = PROJECT_STATUS_TONE[p.status];
                return (
                  <tr
                    key={p.id}
                    style={{
                      borderTop: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      osActions.openWindow({
                        app: 'projects',
                        entityId: p.id,
                        title: p.name,
                        position: 'beside-focused',
                      })
                    }
                  >
                    <Td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.code ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--os-font)',
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {p.code}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
                        <span className="dot" style={{ background: tone.fg }} />
                        {tone.label}
                      </span>
                    </Td>
                    <Td>{p.leadName}</Td>
                    <Td>{p.accountManagerName}</Td>
                    <Td align="right">
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatINRPaise(p.feePaise)}
                      </span>
                    </Td>
                    <Td>{formatShortDate(p.startedAt)}</Td>
                    <Td>{p.endsAt ? formatShortDate(p.endsAt) : 'Ongoing'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) onProjectCreated();
        }}
        clientId={client.id}
        clientName={client.name}
        employees={employees}
        users={users}
      />
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        padding: '10px 14px',
        textAlign: align,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-muted)',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      style={{
        padding: '10px 14px',
        textAlign: align,
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  );
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatINRPaise(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Header (OS-styled, mirrors legacy ClientDetail)                            */
/* -------------------------------------------------------------------------- */

function Header({
  client,
  logoUrl,
  actions,
}: {
  client: Client;
  logoUrl?: string | null;
  actions?: ReactNode;
}) {
  const tone = STATUS_TONE[client.status] ?? STATUS_TONE['inactive']!;
  const statusLabel = client.status.charAt(0).toUpperCase() + client.status.slice(1);
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
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${client.name} logo`}
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            objectFit: 'cover',
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          className="avatar"
          style={{
            width: 56,
            height: 56,
            fontSize: 18,
            background: toneForName(client.name),
            borderRadius: 12,
          }}
        >
          {initials(client.name)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {client.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          {client.code ? (
            <>
              <span className="entity-code" style={{ fontSize: 12 }}>
                {client.code}
              </span>
              {' · '}
            </>
          ) : null}
          {client.industry || '—'} · Managed by {client.accountManager || '—'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
            <span className="dot" style={{ background: tone.fg }} />
            {statusLabel}
          </span>
          <span className="pill">
            <span className="dot" style={{ background: 'var(--text-dim)' }} />
            Onboarded{' '}
            {client.onboardedAt.toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>
      {actions ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview (OS-styled KPI strip + profile card + notes)                       */
/* -------------------------------------------------------------------------- */

function OverviewBody({
  client,
  contacts,
  projects,
  onOpenTab,
}: {
  client: Client;
  contacts: readonly ContactRow[];
  projects: readonly Project[];
  onOpenTab: (tab: ClientTab) => void;
}) {
  const [stats, setStats] = useState<ClientOverviewStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    getClientOverviewStats(client.id)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        /* leave financial tiles as "—" */
      });
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  // Project mix from the already-loaded list (raw DB status is authoritative).
  const active = projects.filter((p) => p.dbStatus === 'active').length;
  const completed = projects.filter((p) => p.dbStatus === 'completed').length;
  const pipeline = projects.filter((p) => p.dbStatus === 'pitch' || p.dbStatus === 'won').length;
  const money = (p: bigint | undefined) => (p === undefined ? '—' : formatINRPaise(p));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Founder headline row — project mix + money. */}
      <div
        style={{
          gridColumn: 'span 2',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <Kpi
          label="Active projects"
          value={String(active)}
          trend={pipeline > 0 ? `${pipeline} in pipeline` : undefined}
          onClick={() => onOpenTab('projects')}
        />
        <Kpi
          label="Completed"
          value={String(completed)}
          trend={`${projects.length} total`}
          onClick={() => onOpenTab('projects')}
        />
        <Kpi
          label="To be collected"
          value={money(stats?.outstandingPaise)}
          accent={stats && stats.outstandingPaise > 0n ? 'var(--apar-red, #c33)' : undefined}
          trend="outstanding receivable"
          onClick={() => onOpenTab('invoices')}
        />
        <Kpi
          label="Pending invoices"
          value={stats ? String(stats.pendingInvoiceCount) : '—'}
          trend="awaiting payment"
          onClick={() => onOpenTab('invoices')}
        />
        <Kpi
          label="Total invoiced"
          value={money(stats?.invoicedTotalPaise)}
          trend={
            stats?.lastInvoiceOn
              ? `last ${formatShortDate(new Date(stats.lastInvoiceOn))}`
              : undefined
          }
          onClick={() => onOpenTab('invoices')}
        />
        <Kpi
          label="Received"
          value={money(stats?.receivedTotalPaise)}
          accent={stats && stats.receivedTotalPaise > 0n ? 'var(--apar-green, #2E8F5A)' : undefined}
          trend={
            stats?.lastPaymentOn
              ? `last ${formatShortDate(new Date(stats.lastPaymentOn))}`
              : undefined
          }
        />
        <Kpi
          label="Contacts"
          value={String(contacts.length)}
          onClick={() => onOpenTab('contacts')}
        />
        <Kpi
          label="Documents"
          value={String(client.documentsCount ?? 0)}
          onClick={() => onOpenTab('documents')}
        />
      </div>
      <OsCard title="Profile">
        <DetailGrid
          items={[
            ['Industry', client.industry || '—'],
            ['Account manager', client.accountManager || '—'],
            ['GSTIN', client.gstin || '—'],
            ['PAN', client.pan || '—'],
          ]}
        />
      </OsCard>
      <OsCard title="Notes">
        {client.notes ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {client.notes}
          </p>
        ) : (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            No notes yet.
          </p>
        )}
      </OsCard>
    </div>
  );
}

function Kpi({
  label,
  value,
  trend,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  trend?: string;
  /** Colour the value (e.g. red for money owed to us). */
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        cursor: onClick ? 'pointer' : undefined,
      }}
      title={onClick ? 'Open' : undefined}
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
      <div className="font-display" style={{ fontSize: 26, marginTop: 4, color: accent }}>
        {value}
      </div>
      {trend ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{trend}</div>
      ) : null}
    </div>
  );
}

function OsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        gridColumn: 'span 2',
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

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

function ActivityBody({ clientId }: { clientId: string }) {
  const { events, isLive } = useRealtimeActivity({
    entityType: 'client',
    entityId: clientId,
    fetchEvents: getEntityActivity,
  });
  return (
    <ActivityFeed events={events} isLive={isLive} onNavigate={navigateBesideFocused} showHeader />
  );
}

/* -------------------------------------------------------------------------- */
/* Ledger tab                                                                  */
/* -------------------------------------------------------------------------- */

function ClientLedgerBody({ clientId }: { clientId: string }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getClientStatement({ clientId })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ledger');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>;
  }
  return (
    <StatementOfAccount
      statement={statement}
      noun="ledger entries"
      balanceMeaning="Positive = client owes us (Trade Receivables 1200)"
      exportName={`client-ledger-${clientId}`}
      // Invoice lines open the invoice PDF itself; everything else opens the
      // plain transaction window.
      onSelectTransaction={(txnId, kind) => openTransactionOrInvoice(txnId, kind)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

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
