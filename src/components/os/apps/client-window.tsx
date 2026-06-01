'use client';

// OS client profile window. Uses the same chrome pattern as the legacy
// ClientDetail in apps.tsx (custom header + .tabs / .tab tab bar + OS
// palette via CSS variables) so the OS theme is preserved. The new
// Section components from `components/entity/` provide the functional
// content inside each tab.

import { useEffect, useState } from 'react';

import { ContactsSection } from '@/components/entity/contacts-section';
import { DocumentsSection } from '@/components/entity/documents-section';
import { ClientTransactionsSection } from '@/components/entity/client-transactions-section';
import { ClientExpensesOnBehalfSection } from '@/components/entity/vendor-bills-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import { getClientStatement, type Statement } from '@/lib/server/ledger/statements';
import { getClient } from '@/lib/server-stub/entity-actions';
import type { Client } from '@/components/clients/types';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

export type ClientWindowProps = {
  clientId: string;
};

type ClientTab =
  | 'overview'
  | 'contacts'
  | 'documents'
  | 'transactions'
  | 'expenses'
  | 'ledger'
  | 'activity';

const TAB_LABELS: Record<ClientTab, string> = {
  overview: 'Overview',
  contacts: 'Contacts',
  documents: 'Documents',
  transactions: 'Transactions',
  expenses: 'Expenses on behalf',
  ledger: 'Ledger',
  activity: 'Activity',
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
  | { kind: 'ready'; client: Client; contacts: readonly ContactRow[] };

export function ClientWindow({ clientId }: ClientWindowProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<ClientTab>('overview');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setState({ kind: 'loading' });
    });
    Promise.all([getClient(clientId), listContacts({ entityType: 'client', entityId: clientId })])
      .then(([client, contacts]) => {
        if (cancelled) return;
        if (!client) {
          setState({
            kind: 'error',
            message: `Client ${clientId} not found.`,
          });
          return;
        }
        setState({ kind: 'ready', client, contacts });
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
  }, [clientId]);

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading client…</div>;
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, color: 'var(--text-error, #c33)' }}>{state.message}</div>;
  }

  const { client, contacts } = state;
  const tabs: readonly ClientTab[] = [
    'overview',
    'contacts',
    'documents',
    'transactions',
    'expenses',
    'ledger',
    'activity',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header client={client} />
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? <OverviewBody client={client} contacts={contacts} /> : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="client"
            entityId={client.id}
            entityName={client.name}
            initial={contacts}
          />
        ) : null}
        {tab === 'documents' ? (
          <DocumentsSection entityType="client" entityId={client.id} entityName={client.name} />
        ) : null}
        {tab === 'transactions' ? (
          <ClientTransactionsSection clientId={client.id} clientName={client.name} />
        ) : null}
        {tab === 'expenses' ? (
          <ClientExpensesOnBehalfSection clientId={client.id} clientName={client.name} />
        ) : null}
        {tab === 'ledger' ? <ClientLedgerBody clientId={client.id} /> : null}
        {tab === 'activity' ? <ActivityBody clientId={client.id} /> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header (OS-styled, mirrors legacy ClientDetail)                            */
/* -------------------------------------------------------------------------- */

function Header({ client }: { client: Client }) {
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {client.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview (OS-styled KPI strip + profile card + notes)                       */
/* -------------------------------------------------------------------------- */

function OverviewBody({ client, contacts }: { client: Client; contacts: readonly ContactRow[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
      <Kpi label="Contacts" value={String(contacts.length)} />
      <Kpi label="Projects" value={String(client.projectsCount)} />
      <Kpi label="Documents" value={String(client.documentsCount)} />
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

function Kpi({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
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
      <div className="font-display" style={{ fontSize: 26, marginTop: 4 }}>
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
