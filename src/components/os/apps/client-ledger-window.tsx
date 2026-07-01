'use client';

// Focused per-client ledger window — what the user opens from the
// Ledger hub. Pure statement-of-account: KPI strip + chronological
// postings table + running AR balance. No tabs, no profile chrome.
//
// The full ClientWindow still exposes the same data in its Ledger tab;
// this window is the one-click drill-in from the Ledger app.

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { exportSlug } from '@/lib/client/export-rows';
import { getClientStatement, type Statement } from '@/lib/server/ledger/statements';
import { getClient } from '@/lib/server-stub/entity-actions';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function ClientLedgerWindow({ clientId }: { clientId: string }) {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [clientName, setClientName] = useState<string>('');
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One-off client name fetch for the header.
  useEffect(() => {
    let cancelled = false;
    getClient(clientId)
      .then((c) => {
        if (!cancelled && c) setClientName(c.name);
      })
      .catch(() => {
        // Best-effort — header just shows the id.
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getClientStatement({ clientId, from: fromDate, to: toDate })
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
  }, [clientId, fromDate, toDate]);

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
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            {clientName || clientId} — Ledger
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every posting sub-ledgered to this client (Trade Receivables 1200, Reimbursables 1240,
            Advances 2180). Closing balance = what they owe us.
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
        <button
          type="button"
          className="btn"
          onClick={() =>
            osActions.openWindow({
              app: 'clients',
              entityId: clientId,
              title: clientName || 'Client',
              position: 'beside-focused',
            })
          }
          title="Open the full client profile beside"
        >
          Open profile →
        </button>
      </header>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="ledger entries"
          balanceMeaning="Positive = client owes us (Trade Receivables 1200); negative (green) = client credit balance held with us"
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`client-ledger-${exportSlug(clientName || clientId)}-${fromDate}_to_${toDate}`}
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

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 12,
          color: 'var(--text)',
        }}
      />
    </label>
  );
}
