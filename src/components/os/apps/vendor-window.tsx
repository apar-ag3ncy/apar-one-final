'use client';

// OS vendor profile window. Uses the same OS chrome pattern as the
// client window (custom header + .tabs / .tab tab bar + CSS variables)
// so the OS theme is preserved.

import { useEffect, useState, type ReactNode } from 'react';

import { ContactsSection } from '@/components/entity/contacts-section';
import { BankAccountsSection } from '@/components/entity/bank-accounts-section';
import { EntitySettingsSection } from '@/components/entity/entity-settings-section';
import { VendorEditDialog } from './vendor-edit-dialog';
import { DocumentsSection } from '@/components/entity/documents-section';
import { VendorBillsSection } from '@/components/entity/vendor-bills-section';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { useRealtimeActivity } from '@/lib/client/use-realtime-activity';
import { getEntityActivity } from '@/lib/server/entities/activity';
import { listContacts, type ContactRow } from '@/lib/server/entities/contacts';
import { getVendorStatement, type Statement } from '@/lib/server/ledger/statements';
import { getVendor } from '@/lib/server-stub/entity-actions';
import type { Vendor } from '@/components/vendors/types';
import { osActions } from '@/lib/os/store';
import { navigateBesideFocused } from './navigate';

export type VendorWindowProps = {
  vendorId: string;
  onClose?: () => void;
};

type VendorTab =
  | 'overview'
  | 'contacts'
  | 'bank'
  | 'documents'
  | 'bills'
  | 'ledger'
  | 'activity'
  | 'settings';

const TAB_LABELS: Record<VendorTab, string> = {
  overview: 'Overview',
  contacts: 'Contacts',
  bank: 'Bank accounts',
  documents: 'Documents',
  bills: 'Bills',
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
    'contacts',
    'bank',
    'documents',
    'bills',
    'ledger',
    'activity',
    'settings',
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Header
        vendor={vendor}
        actions={<VendorEditDialog vendor={vendor} onSaved={() => setReloadKey((k) => k + 1)} />}
      />
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'overview' ? <OverviewBody vendor={vendor} contacts={contacts} /> : null}
        {tab === 'contacts' ? (
          <ContactsSection
            entityType="vendor"
            entityId={vendor.id}
            entityName={vendor.name}
            initial={contacts}
          />
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

function OverviewBody({ vendor, contacts }: { vendor: Vendor; contacts: readonly ContactRow[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
      <Kpi label="Contacts" value={String(contacts.length)} />
      <Kpi label="Documents" value={String(vendor.documentsCount)} />
      <Kpi label="Contracts" value={String(vendor.contractsCount)} />
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
