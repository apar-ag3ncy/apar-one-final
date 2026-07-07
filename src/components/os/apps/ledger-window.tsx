'use client';

// Ledger hub — the landing page of the Ledger app. Card-based directory of
// every book we can render: the office books, one ledger per client and one
// per vendor — each client/vendor card shows its live outstanding balance
// (from the AR/AP aging queries, one batch query per side).
//
// Clicking a card opens the focused statement-of-account window beside the
// hub via the 'ledger' app's entityId sub-routes:
//   office              → OfficeLedgerWindow
//   office-utilities    → OfficeUtilitiesWindow
//   tds                 → TdsBookWindow
//   client:<uuid>       → ClientLedgerWindow
//   vendor:<uuid>       → VendorLedgerWindow

import { useEffect, useMemo, useState } from 'react';
import { BanknoteIcon, BoltIcon, BuildingIcon, ReceiptIcon, TruckIcon } from 'lucide-react';

import { formatINR } from '@/components/shared/format-inr';
import { osActions } from '@/lib/os/store';
import { listClients, listVendors } from '@/lib/server-stub/entity-actions';
import { getAgingReport } from '@/lib/server-stub/ledger-actions';

type ClientItem = { id: string; name: string; industry: string };
type VendorItem = { id: string; name: string; category: string };

export type LedgerWindowProps = {
  // kept for compat with the older signature; the hub doesn't use them.
  scope?: 'all' | 'entity';
  entityId?: string;
  entityName?: string;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LedgerWindow(_props: LedgerWindowProps = {}) {
  void _props;
  const [clients, setClients] = useState<readonly ClientItem[] | null>(null);
  const [vendors, setVendors] = useState<readonly VendorItem[] | null>(null);
  const [arMap, setArMap] = useState<ReadonlyMap<string, bigint>>(new Map());
  const [apMap, setApMap] = useState<ReadonlyMap<string, bigint>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const today = todayISO();
    Promise.all([listClients(), listVendors()])
      .then(([cs, vs]) => {
        if (cancelled) return;
        // Archived entities keep their ledgers queryable from old references,
        // but they must not be listed in the hub.
        setClients(
          cs
            .filter((c) => c.status !== 'archived')
            .map((c) => ({ id: c.id, name: c.name, industry: c.industry })),
        );
        setVendors(vs.map((v) => ({ id: v.id, name: v.name, category: v.category })));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ledgers list');
        }
      });
    // Outstanding balances — one batched query per side; non-fatal if either fails.
    getAgingReport({ side: 'receivable', asOfDate: today })
      .then((rows) => {
        if (!cancelled) setArMap(new Map(rows.map((r) => [r.entityId, r.totalPaise])));
      })
      .catch(() => {});
    getAgingReport({ side: 'payable', asOfDate: today })
      .then((rows) => {
        if (!cancelled) setApMap(new Map(rows.map((r) => [r.entityId, r.totalPaise])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filteredClients = useMemo(
    () =>
      (clients ?? []).filter(
        (c) => !q || c.name.toLowerCase().includes(q) || c.industry.toLowerCase().includes(q),
      ),
    [clients, q],
  );
  const filteredVendors = useMemo(
    () =>
      (vendors ?? []).filter(
        (v) => !q || v.name.toLowerCase().includes(q) || v.category.toLowerCase().includes(q),
      ),
    [vendors, q],
  );

  function openLedger(entityId: string, title: string) {
    osActions.openWindow({
      app: 'ledger',
      entityId,
      title,
      position: 'beside-focused',
    });
  }

  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div className="main-header">
        <h2>Ledgers</h2>
        <span className="sub">
          {clients && vendors
            ? `${clients.length} clients · ${vendors.length} vendors · 3 office books`
            : '—'}
        </span>
        <div className="grow" />
        <div className="search-input">
          <input
            placeholder="Search clients, vendors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13, padding: 18 }}>{error}</p>
      ) : (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '18px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Office books */}
          <Section title="Office">
            <CardGrid>
              <LedgerCard
                icon={<BanknoteIcon style={iconStyle} aria-hidden />}
                accent="#2E8F5A"
                title="Cash + Bank"
                subtitle="The money book — every rupee in and out"
                onClick={() => openLedger('office', 'Office ledger')}
              />
              <LedgerCard
                icon={<BoltIcon style={iconStyle} aria-hidden />}
                accent="#C46A28"
                title="Office utilities"
                subtitle="Rent, electricity, internet & everyday spend"
                onClick={() => openLedger('office-utilities', 'Office utilities ledger')}
              />
              <LedgerCard
                icon={<ReceiptIcon style={iconStyle} aria-hidden />}
                accent="#5B6677"
                title="TDS book"
                subtitle="Tax cut from payments, both directions"
                onClick={() => openLedger('tds', 'TDS book')}
              />
            </CardGrid>
          </Section>

          {/* Clients */}
          <Section
            title="Clients"
            subtitle={
              clients
                ? `${filteredClients.length}${q ? ` of ${clients.length}` : ''} client${
                    filteredClients.length === 1 ? '' : 's'
                  }`
                : 'Loading…'
            }
          >
            {filteredClients.length === 0 ? (
              <Muted>
                {clients === null
                  ? 'Loading clients…'
                  : q
                    ? 'No clients match the search.'
                    : 'No clients yet. Add one from the Accounts app.'}
              </Muted>
            ) : (
              <CardGrid>
                {filteredClients.map((c) => (
                  <LedgerCard
                    key={c.id}
                    icon={<BuildingIcon style={iconStyle} aria-hidden />}
                    accent={toneForName(c.name)}
                    title={c.name}
                    subtitle={c.industry || 'No industry set'}
                    amountPaise={arMap.get(c.id) ?? null}
                    amountLabel="owes us"
                    onClick={() => openLedger(`client:${c.id}`, `${c.name} — Ledger`)}
                  />
                ))}
              </CardGrid>
            )}
          </Section>

          {/* Vendors */}
          <Section
            title="Vendors"
            subtitle={
              vendors
                ? `${filteredVendors.length}${q ? ` of ${vendors.length}` : ''} vendor${
                    filteredVendors.length === 1 ? '' : 's'
                  }`
                : 'Loading…'
            }
          >
            {filteredVendors.length === 0 ? (
              <Muted>
                {vendors === null
                  ? 'Loading vendors…'
                  : q
                    ? 'No vendors match the search.'
                    : 'No vendors yet. Add one from the Accounts app.'}
              </Muted>
            ) : (
              <CardGrid>
                {filteredVendors.map((v) => (
                  <LedgerCard
                    key={v.id}
                    icon={<TruckIcon style={iconStyle} aria-hidden />}
                    accent={toneForName(v.name)}
                    title={v.name}
                    subtitle={v.category || 'Uncategorized'}
                    amountPaise={apMap.get(v.id) ?? null}
                    amountLabel="we owe"
                    onClick={() => openLedger(`vendor:${v.id}`, `${v.name} — Ledger`)}
                  />
                ))}
              </CardGrid>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

const iconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  color: '#fff',
  flexShrink: 0,
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h3
          style={{
            fontSize: 11,
            fontWeight: 600,
            margin: 0,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          {title}
        </h3>
        {subtitle ? (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{subtitle}</span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function LedgerCard({
  icon,
  accent,
  title,
  subtitle,
  amountPaise,
  amountLabel,
  onClick,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  subtitle?: string;
  /** Outstanding balance to surface on the card; hidden when null or zero. */
  amountPaise?: bigint | null;
  amountLabel?: string;
  onClick: () => void;
}) {
  const showAmount = amountPaise != null && amountPaise !== 0n;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 9,
            background: accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          width: '100%',
          gap: 8,
        }}
      >
        {showAmount ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{amountLabel}</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>settled up</span>
        )}
        {showAmount ? (
          <span
            className="font-display"
            style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatINR(amountPaise)}
          </span>
        ) : (
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Open ledger →
          </span>
        )}
      </div>
    </button>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12,
        color: 'var(--text-muted)',
        margin: 0,
        padding: '8px 12px',
        fontStyle: 'italic',
      }}
    >
      {children}
    </p>
  );
}

const TONES = ['#7A4E2D', '#3F4E8E', '#5E7344', '#7A2D4E', '#2D5E7A', '#7A6A2D'] as const;
function toneForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TONES[Math.abs(hash) % TONES.length]!;
}
