'use client';

// OS vendor profile window. Uses the same OS chrome pattern as the
// client window (custom header + .tabs / .tab tab bar + CSS variables)
// so the OS theme is preserved.

import { useEffect, useState, type ReactNode } from 'react';

import { ContactsSection } from '@/components/entity/contacts-section';
import { AddressesSection } from '@/components/entity/addresses-section';
import { BankAccountsSection } from '@/components/entity/bank-accounts-section';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { VendorEditDialog } from './vendor-edit-dialog';
import { useEntityMutation } from '../auth/entity-mutation-gate';
import { DocumentsSection } from '@/components/entity/documents-section';
import { VendorBillsSection } from '@/components/entity/vendor-bills-section';
import { VendorPaymentsSection } from '@/components/entity/vendor-payments-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import {
  getVendorStats,
  type VendorProjectStat,
  type VendorStats,
} from '@/lib/server/entities/vendor-stats';
import { getVendorStatement, type Statement } from '@/lib/server/ledger/statements';
import {
  listVendorProjectTasks,
  type VendorProjectTaskRow,
} from '@/lib/server/entities/project-tasks';
import { getVendor } from '@/lib/server-stub/entity-actions';
import type { Vendor } from '@/components/vendors/types';
import { osActions } from '@/lib/os/store';
import { formatINR } from '../format';
import { navigateBesideFocused } from './navigate';

export type VendorWindowProps = {
  vendorId: string;
  onClose?: () => void;
};

type VendorTab =
  | 'overview'
  | 'stats'
  | 'priorities'
  | 'contacts'
  | 'addresses'
  | 'bank'
  | 'documents'
  | 'bills'
  | 'transactions'
  | 'ledger'
  | 'activity'
  | 'settings';

const TAB_LABELS: Record<VendorTab, string> = {
  overview: 'Overview',
  stats: 'Statistics',
  priorities: 'Priorities',
  contacts: 'Contacts',
  addresses: 'Addresses',
  bank: 'Bank accounts',
  documents: 'Documents',
  bills: 'Bills',
  transactions: 'Transactions',
  ledger: 'Ledger',
  activity: 'Activity',
  settings: 'Settings',
};

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#1f6b3b', fg: '#a4d8b3' },
  inactive: { bg: '#3a3a3a', fg: '#bdbdbd' },
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; vendor: Vendor; contacts: readonly ContactRow[] };

export function VendorWindow({ vendorId, onClose }: VendorWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<VendorTab>('overview');
  const [reloadKey, setReloadKey] = useState(0);
  // OS edit grant for the vendors app (provided by os-root's EntityMutationGate).
  const { canEdit } = useEntityMutation();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ kind: 'loading' });
    });
    Promise.all([getVendor(vendorId), listContacts({ entityType: 'vendor', entityId: vendorId })])
      .then(([vendor, contacts]) => {
        if (cancelled) return;
        if (!vendor) {
          setState({ kind: 'error', message: `Vendor ${vendorId} not found.` });
          return;
        }
        setState({ kind: 'ready', vendor, contacts });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Failed to load vendor',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId, reloadKey]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading vendor…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--text-error, #c33)' }}>{state.message}</div>;
  }

  const { vendor, contacts } = state;
  const tabs: readonly VendorTab[] = [
    'overview',
    'stats',
    'priorities',
    'contacts',
    'addresses',
    'bank',
    'documents',
    'bills',
    'transactions',
    'ledger',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header
        vendor={vendor}
        actions={
          canEdit ? (
            <VendorEditDialog vendor={vendor} onSaved={() => setReloadKey((k) => k + 1)} />
          ) : undefined
        }
      />
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? (
          <OverviewBody vendor={vendor} contacts={contacts} onOpenTab={setTab} />
        ) : null}
        {tab === 'stats' ? <StatsBody vendorId={vendor.id} /> : null}
        {tab === 'priorities' ? <PrioritiesBody vendorId={vendor.id} /> : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="vendor"
            entityId={vendor.id}
            entityName={vendor.name}
            initial={contacts}
          />
        ) : null}
        {tab === 'addresses' ? (
          <AddressesSection entityType="vendor" entityId={vendor.id} entityName={vendor.name} />
        ) : null}
        {tab === 'bank' ? (
          <BankAccountsSection entityType="vendor" entityId={vendor.id} entityName={vendor.name} />
        ) : null}
        {tab === 'documents' ? (
          <DocumentsSection
            entityType="vendor"
            entityId={vendor.id}
            entityName={vendor.name}
            onUploaded={() => setReloadKey((k) => k + 1)}
          />
        ) : null}
        {tab === 'bills' ? (
          <VendorBillsSection vendorId={vendor.id} vendorName={vendor.name} />
        ) : null}
        {tab === 'transactions' ? (
          <VendorPaymentsSection vendorId={vendor.id} vendorName={vendor.name} />
        ) : null}
        {tab === 'ledger' ? <VendorLedgerBody vendorId={vendor.id} /> : null}
        {tab === 'activity' ? <ActivityBody vendorId={vendor.id} /> : null}
        {tab === 'settings' ? (
          <EntitySettingsSection
            kind="vendor"
            entityId={vendor.id}
            entityName={vendor.name}
            isArchived={vendor.isArchived ?? vendor.status === 'inactive'}
            onChanged={() => setReloadKey((k) => k + 1)}
            onDeleted={onClose}
          />
        ) : null}
      </div>
    </div>
  );
}

function Header({ vendor, actions }: { vendor: Vendor; actions?: ReactNode }) {
  const tone = STATUS_TONE[vendor.status] ?? STATUS_TONE['inactive']!;
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
          background: toneForName(vendor.name),
          borderRadius: 12,
        }}
      >
        {initials(vendor.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {vendor.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
          {vendor.code ? (
            <>
              <span className="entity-code" style={{ fontSize: 12 }}>
                {vendor.code}
              </span>
              {' · '}
            </>
          ) : null}
          {vendor.category}
          {vendor.city ? ` · ${vendor.city}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <span className="pill" style={{ background: tone.bg, color: tone.fg }}>
            <span className="dot" style={{ background: tone.fg }} />
            {vendor.status.charAt(0).toUpperCase() + vendor.status.slice(1)}
          </span>
          {vendor.gstin ? (
            <span className="pill">
              <span className="dot" style={{ background: 'var(--text-dim)' }} />
              GSTIN {vendor.gstin}
            </span>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>
      ) : null}
    </div>
  );
}

function OverviewBody({
  vendor,
  contacts,
  onOpenTab,
}: {
  vendor: Vendor;
  contacts: readonly ContactRow[];
  onOpenTab: (tab: VendorTab) => void;
}) {
  const [stats, setStats] = useState<VendorStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    getVendorStats(vendor.id)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        /* leave financial tiles as "—" */
      });
    return () => {
      cancelled = true;
    };
  }, [vendor.id]);
  const money = (p: bigint | undefined) => (p === undefined ? '—' : formatINR(p));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
      <div
        style={{
          gridColumn: 'span 3',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        <Kpi
          label="Active projects"
          value={stats ? String(stats.projectsAssigned - stats.projectsCompleted) : '—'}
          trend={
            stats
              ? `${stats.projectsCompleted} completed · ${stats.projectsTotal} total`
              : undefined
          }
          onClick={() => onOpenTab('stats')}
        />
        <Kpi
          label="To pay"
          value={money(stats?.payablePaise)}
          accent={stats && stats.payablePaise > 0n ? 'var(--apar-red, #c33)' : undefined}
          trend="outstanding payable"
          onClick={() => onOpenTab('stats')}
        />
        <Kpi
          label="Pending bills"
          value={stats ? String(stats.pendingBillCount) : '—'}
          trend={stats ? `${stats.billCount} bills total` : undefined}
          onClick={() => onOpenTab('stats')}
        />
        <Kpi
          label="Billed"
          value={money(stats?.billsTotalPaise)}
          onClick={() => onOpenTab('stats')}
        />
        <Kpi
          label="Paid"
          value={money(stats?.paidTotalPaise)}
          accent={stats && stats.paidTotalPaise > 0n ? 'var(--apar-green, #2E8F5A)' : undefined}
          onClick={() => onOpenTab('stats')}
        />
        <Kpi
          label="Contacts"
          value={String(contacts.length)}
          onClick={() => onOpenTab('contacts')}
        />
      </div>
      <OsCard title="Profile">
        <DetailGrid
          items={[
            ['Category', vendor.category],
            ['TDS section', vendor.tdsSection || '—'],
            ['GSTIN', vendor.gstin || '—'],
            ['PAN', vendor.pan || '—'],
          ]}
        />
      </OsCard>
      <OsCard title="Notes">
        {vendor.notes ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {vendor.notes}
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

// Tones for the DB project_status enum (schema/projects.ts) — the stats list
// shows the real project rows, not the OS-side localStorage statuses.
const PROJECT_STATUS_TONE: Record<
  VendorProjectStat['status'],
  { bg: string; fg: string; label: string }
> = {
  pitch: { bg: '#1a3b6e', fg: '#9ec2f0', label: 'Pitch' },
  won: { bg: '#1a5e6e', fg: '#9edef0', label: 'Won' },
  active: { bg: '#1f6b3b', fg: '#a4d8b3', label: 'Active' },
  on_hold: { bg: '#7a5a17', fg: '#e7c980', label: 'On hold' },
  completed: { bg: '#3a3a78', fg: '#bdbdf5', label: 'Completed' },
  cancelled: { bg: '#3a3a3a', fg: '#bdbdbd', label: 'Cancelled' },
};

// Vendor statistics (founder change-batch §6): billed / paid / payable KPIs
// derived live from the ledger, plus the projects this vendor has posted
// bills against. All money is bigint paise through formatINR.
function StatsBody({ vendorId }: { vendorId: string }) {
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStats(null);
      setError(null);
    });
    getVendorStats(vendorId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load statistics');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>;
  }
  if (!stats) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading statistics…</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
      <Kpi
        label="Projects"
        value={String(stats.projectsAssigned)}
        trend={`${stats.projectsCompleted} completed · ${stats.projectsTotal} total`}
      />
      <Kpi
        label="Billed"
        value={formatINR(stats.billsTotalPaise)}
        trend={`${stats.billCount} posted ${stats.billCount === 1 ? 'bill' : 'bills'}`}
      />
      <Kpi label="Paid" value={formatINR(stats.paidTotalPaise)} trend="Payments made" />
      <Kpi
        label="Payable"
        value={formatINR(stats.payablePaise)}
        trend="Billed − allocated payments"
      />
      <Kpi
        label="Bills"
        value={String(stats.billCount)}
        trend={`${stats.pendingBillCount} pending · ${stats.completedBillCount} completed`}
      />
      <OsCard title="Projects">
        {stats.projects.length === 0 ? (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              margin: 0,
            }}
          >
            No projects billed by this vendor yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {stats.projects.map((p, i) => {
              const tone = PROJECT_STATUS_TONE[p.status];
              return (
                <div
                  key={p.projectId}
                  onClick={() =>
                    osActions.openWindow({
                      app: 'projects',
                      entityId: p.projectId,
                      title: p.projectName,
                      position: 'beside-focused',
                    })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.projectName}
                  </span>
                  <span
                    className="pill"
                    style={{ background: tone.bg, color: tone.fg, flexShrink: 0 }}
                  >
                    <span className="dot" style={{ background: tone.fg }} />
                    {tone.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </OsCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Priorities — deliverables handed over to this vendor (§6.3 / §6.5)          */
/* -------------------------------------------------------------------------- */

const PRIORITY_META: Record<string, { label: string; bg: string; fg: string }> = {
  urgent_important: { label: 'Urgent & Important', bg: '#6e1a1a', fg: '#f0a2a2' },
  urgent: { label: 'Urgent', bg: '#7a4e17', fg: '#e7c980' },
  important: { label: 'Important', bg: '#1a3b6e', fg: '#9ec2f0' },
  nice: { label: 'Nice / later', bg: '#3a3a3a', fg: '#bdbdbd' },
};

function PrioritiesBody({ vendorId }: { vendorId: string }) {
  const [tasks, setTasks] = useState<readonly VendorProjectTaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTasks(null);
      setError(null);
    });
    listVendorProjectTasks(vendorId)
      .then((t) => {
        if (!cancelled) setTasks(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load priorities');
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>;
  }
  if (!tasks) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading priorities…</div>;
  }

  const pending = tasks.filter((t) => t.status !== 'done');
  const completed = tasks.filter((t) => t.status === 'done');

  const openProject = (t: VendorProjectTaskRow) =>
    osActions.openWindow({
      app: 'projects',
      entityId: t.projectId,
      title: t.projectName,
      position: 'beside-focused',
    });

  const renderTask = (t: VendorProjectTaskRow, i: number) => {
    const pr = t.priority ? PRIORITY_META[t.priority] : null;
    return (
      <div
        key={t.taskId}
        onClick={() => openProject(t)}
        title={`Open ${t.projectName}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 0',
          borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.title}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {t.projectName}
            {t.projectCode ? ` · ${t.projectCode}` : ''}
            {t.dueOn ? ` · due ${t.dueOn}` : ''}
            {t.completedAt ? ` · done ${t.completedAt.slice(0, 10)}` : ''}
          </span>
        </div>
        {pr ? (
          <span
            className="pill"
            style={{ background: pr.bg, color: pr.fg, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            <span className="dot" style={{ background: pr.fg }} />
            {pr.label}
          </span>
        ) : null}
      </div>
    );
  };

  const emptyNote = (msg: string) => (
    <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
      {msg}
    </p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <OsCard title={`Pending (${pending.length})`}>
        {pending.length === 0
          ? emptyNote('Nothing pending — no open deliverables handed to this vendor.')
          : pending.map(renderTask)}
      </OsCard>
      <OsCard title={`Completed (${completed.length})`}>
        {completed.length === 0
          ? emptyNote('No completed deliverables yet.')
          : completed.map(renderTask)}
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
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Open' : undefined}
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        cursor: onClick ? 'pointer' : undefined,
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

function ActivityBody({ vendorId }: { vendorId: string }) {
  const { events, isLive } = useRealtimeActivity({
    entityType: 'vendor',
    entityId: vendorId,
    fetchEvents: getEntityActivity,
  });
  return (
    <ActivityFeed events={events} isLive={isLive} onNavigate={navigateBesideFocused} showHeader />
  );
}

function VendorLedgerBody({ vendorId }: { vendorId: string }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getVendorStatement({ vendorId })
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
  }, [vendorId]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>;
  }
  return (
    <StatementOfAccount
      statement={statement}
      noun="ledger entries"
      balanceMeaning="Positive = we owe the vendor (Trade Payables 2110)"
      exportName={`vendor-ledger-${vendorId}`}
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
