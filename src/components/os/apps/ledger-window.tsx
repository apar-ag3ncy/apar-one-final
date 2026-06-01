'use client';

// Ledger hub — the landing page of the Ledger app. Lists every
// entity-scoped ledger we can render today:
//   - Office (cash + bank, accounts 1110 + 1120)
//   - Office utilities (account 6200)
//   - Per-client ledger (Trade Receivables 1200 + co)
//   - Per-vendor ledger (Trade Payables 2110 + co)
//
// Clicking a row opens the focused statement-of-account window beside
// the hub via the existing 'ledger' app's entityId sub-routes:
//   office              → OfficeLedgerWindow
//   office-utilities    → OfficeUtilitiesWindow
//   client:<uuid>       → ClientLedgerWindow
//   vendor:<uuid>       → VendorLedgerWindow

import { useEffect, useMemo, useState } from 'react';
import { BanknoteIcon, BoltIcon, BuildingIcon, TruckIcon } from 'lucide-react';

import { osActions } from '@/lib/os/store';
import { listClients, listVendors } from '@/lib/server-stub/entity-actions';

type ClientItem = { id: string; name: string; industry: string };
type VendorItem = { id: string; name: string; category: string };

export type LedgerWindowProps = {
  // kept for compat with the older signature; the hub doesn't use them.
  scope?: 'all' | 'entity';
  entityId?: string;
  entityName?: string;
};

export function LedgerWindow(_props: LedgerWindowProps = {}) {
  void _props;
  const [clients, setClients] = useState<readonly ClientItem[] | null>(null);
  const [vendors, setVendors] = useState<readonly VendorItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([listClients(), listVendors()])
      .then(([cs, vs]) => {
        if (cancelled) return;
        setClients(cs.map((c) => ({ id: c.id, name: c.name, industry: c.industry })));
        setVendors(vs.map((v) => ({ id: v.id, name: v.name, category: v.category })));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load ledgers list');
        }
      });
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
            ? `${clients.length} clients · ${vendors.length} vendors · 2 office books`
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
            gap: 22,
          }}
        >
          {/* Office books */}
          <Section title="Office" subtitle="Our own books">
            <Row
              icon={<BanknoteIcon style={iconStyle} aria-hidden />}
              title="Cash + Bank"
              subtitle="Accounts 1110 + 1120 · running cash position"
              onClick={() => openLedger('office', 'Office ledger')}
            />
            <Row
              icon={<BoltIcon style={iconStyle} aria-hidden />}
              title="Office utilities"
              subtitle="Account 6200 · rent + electricity + internet + water"
              onClick={() => openLedger('office-utilities', 'Office utilities ledger')}
            />
          </Section>

          {/* Clients */}
          <Section
            title="Clients"
            subtitle={
              clients
                ? `${filteredClients.length}${q ? ` of ${clients.length}` : ''} client${
                    filteredClients.length === 1 ? '' : 's'
                  } · positive balance = client owes us`
                : 'Loading…'
            }
          >
            {filteredClients.length === 0 ? (
              <Muted>
                {clients === null
                  ? 'Loading clients…'
                  : q
                    ? 'No clients match the search.'
                    : 'No clients yet. Add one from the Clients app.'}
              </Muted>
            ) : (
              filteredClients.map((c) => (
                <Row
                  key={c.id}
                  icon={<BuildingIcon style={iconStyle} aria-hidden />}
                  title={c.name}
                  subtitle={c.industry || 'No industry set'}
                  onClick={() => openLedger(`client:${c.id}`, `${c.name} — Ledger`)}
                />
              ))
            )}
          </Section>

          {/* Vendors */}
          <Section
            title="Vendors"
            subtitle={
              vendors
                ? `${filteredVendors.length}${q ? ` of ${vendors.length}` : ''} vendor${
                    filteredVendors.length === 1 ? '' : 's'
                  } · positive balance = we owe the vendor`
                : 'Loading…'
            }
          >
            {filteredVendors.length === 0 ? (
              <Muted>
                {vendors === null
                  ? 'Loading vendors…'
                  : q
                    ? 'No vendors match the search.'
                    : 'No vendors yet. Add one from the Vendors app.'}
              </Muted>
            ) : (
              filteredVendors.map((v) => (
                <Row
                  key={v.id}
                  icon={<TruckIcon style={iconStyle} aria-hidden />}
                  title={v.name}
                  subtitle={v.category || 'Uncategorized'}
                  onClick={() => openLedger(`vendor:${v.id}`, `${v.name} — Ledger`)}
                />
              ))
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

const iconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  color: 'var(--text-muted)',
  flexShrink: 0,
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</span>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </section>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 12px',
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
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
