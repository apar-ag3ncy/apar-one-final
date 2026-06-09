'use client';

// OS project profile window. Mirrors the chrome pattern from ClientWindow /
// EmployeeWindow / VendorWindow — header + .tabs / .tab tab bar + OS palette
// via CSS variables — so the OS theme is preserved. Tab bodies reuse the
// shared section components from `@/components/entity/` so behaviour stays
// in sync with the dashboard.

import { useEffect, useState } from 'react';

import { ActivityFeed } from '@/components/entity/activity-feed';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { TransactionList, type Transaction } from '@/components/entity/transaction-list';
import { ProjectStatusChanger } from '@/components/projects/project-status-changer';
import {
  PROJECT_DB_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from '@/components/projects/types';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { getProject, listProjectTransactions } from '@/lib/server-stub/entity-actions';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

export type ProjectWindowProps = {
  projectId: string;
  onClose?: () => void;
};

type ProjectTab = 'overview' | 'transactions' | 'documents' | 'activity' | 'settings';

const TAB_LABELS: Record<ProjectTab, string> = {
  overview: 'Overview',
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
    'transactions',
    'documents',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header project={project} onStatusChanged={() => setReloadKey((k) => k + 1)} />
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

function Header({ project, onStatusChanged }: { project: Project; onStatusChanged?: () => void }) {
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
      <div style={{ flexShrink: 0 }}>
        <ProjectStatusChanger
          projectId={project.id}
          value={project.dbStatus}
          onChanged={onStatusChanged}
        />
      </div>
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
