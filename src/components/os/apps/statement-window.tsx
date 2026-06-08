'use client';

// Statement of Account — native OS window. Pick a client or vendor + a date
// range and render their chronological ledger statement (the shared
// StatementOfAccount component, which carries running balance, CSV/Excel
// export, and click-to-open-transaction). Mirrors /reports/statement but
// fully inside the OS instead of opening a dashboard route in a new tab.

import { useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import {
  getClientStatement,
  getVendorStatement,
  type Statement,
} from '@/lib/server/ledger/statements';
import { listClients, listVendors } from '@/lib/server-stub/entity-actions';
import { osActions } from '@/lib/os/store';
import { exportSlug } from '@/lib/client/export-rows';
import { currentFyDefaults, DateField, useReportData } from './report-window-kit';

type Party = { id: string; name: string };

export function StatementWindow() {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [side, setSide] = useState<'client' | 'vendor'>('client');
  const [entityId, setEntityId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);

  const { data: clients } = useReportData<readonly Party[]>(
    () => listClients().then((rows) => rows.map((c) => ({ id: c.id, name: c.name }))),
    [],
  );
  const { data: vendors } = useReportData<readonly Party[]>(
    () => listVendors().then((rows) => rows.map((v) => ({ id: v.id, name: v.name }))),
    [],
  );

  const options: readonly Party[] = (side === 'client' ? clients : vendors) ?? [];

  // Derive the effective selection rather than storing a default via an effect
  // (avoids set-state-in-effect cascading renders): the user's explicit choice
  // wins when it's valid for the current side, otherwise fall back to the first
  // party. Switching side auto-selects that side's first party.
  const selectedId =
    entityId && options.some((o) => o.id === entityId) ? entityId : (options[0]?.id ?? '');

  const { data: statement, error } = useReportData<Statement | null>(
    () =>
      selectedId
        ? side === 'client'
          ? getClientStatement({ clientId: selectedId, from: fromDate, to: toDate })
          : getVendorStatement({ vendorId: selectedId, from: fromDate, to: toDate })
        : Promise.resolve(null),
    [side, selectedId, fromDate, toDate],
  );

  const entityName = options.find((o) => o.id === selectedId)?.name ?? '';
  const balanceMeaning =
    side === 'client'
      ? 'Positive = client owes us (Trade Receivables 1200)'
      : 'Positive = we owe the vendor (Trade Payables 2110)';

  const listsLoaded = clients != null && vendors != null;

  return (
    <div
      className="main"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 18, gap: 14 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            Statement of Account
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Per-party ledger statement with running balance. Click a row to open the transaction.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setSide('client')}
            style={side === 'client' ? { borderColor: 'var(--accent, #E63A1F)' } : undefined}
            aria-pressed={side === 'client'}
          >
            Client
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setSide('vendor')}
            style={side === 'vendor' ? { borderColor: 'var(--accent, #E63A1F)' } : undefined}
            aria-pressed={side === 'vendor'}
          >
            Vendor
          </button>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {side === 'client' ? 'Client' : 'Vendor'}
          </span>
          <select
            value={selectedId}
            onChange={(e) => setEntityId(e.target.value)}
            style={{
              background: 'var(--content-2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              color: 'var(--text)',
              minWidth: 180,
            }}
          >
            {options.length === 0 ? <option value="">—</option> : null}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
      </header>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : listsLoaded && options.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No {side === 'client' ? 'clients' : 'vendors'} to show a statement for yet.
        </p>
      ) : !selectedId ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Select a {side === 'client' ? 'client' : 'vendor'} to view its statement.
        </p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="ledger entries"
          balanceMeaning={balanceMeaning}
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`statement-${side}-${exportSlug(entityName || selectedId)}-${fromDate}_to_${toDate}`}
          onSelectTransaction={(txnId) =>
            osActions.openWindow({
              app: 'transactions',
              entityId: txnId,
              title: 'Transaction',
              position: 'beside-focused',
            })
          }
        />
      )}
    </div>
  );
}
