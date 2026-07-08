'use client';

// Focused per-client ledger window — what the user opens from the
// Ledger hub. Pure statement-of-account: KPI strip + chronological
// postings table + running AR balance. No tabs, no profile chrome.
//
// The full ClientWindow still exposes the same data in its Ledger tab;
// this window is the one-click drill-in from the Ledger app.

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { formatINR } from '@/components/shared/format-inr';
import { exportSlug } from '@/lib/client/export-rows';
import { getClientStatement, type Statement } from '@/lib/server/ledger/statements';
import { getClient } from '@/lib/server-stub/entity-actions';
import { getAgingReport } from '@/lib/server-stub/ledger-actions';
import type { AgingBucket, AgingRow } from '@/lib/server-stub/ledger-types';
import { osActions } from '@/lib/os/store';

const AGING_BUCKETS: readonly AgingBucket[] = ['0-30', '31-60', '61-90', '90+'];

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
  // Loaded AR aging snapshot: `row` is this client's line (null = settled up).
  // The whole thing stays null while loading or if the aging query fails —
  // the KPI strip degrades to an em-dash instead of blocking the statement.
  const [aging, setAging] = useState<{ row: AgingRow | null } | null>(null);
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

  // Outstanding-as-of-today snapshot from the AR aging report — one batched
  // query, filtered down to this client. Non-fatal: on failure the KPI strip
  // just shows an em-dash.
  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    getAgingReport({ side: 'receivable', asOfDate: today })
      .then((rows) => {
        if (!cancelled) setAging({ row: rows.find((r) => r.entityId === clientId) ?? null });
      })
      .catch(() => {});
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

  // Period totals derived from the loaded statement lines (display-only
  // bigint arithmetic): what we invoiced vs what they paid in the window.
  const periodTotals = useMemo(() => {
    if (!statement) return null;
    let invoicedPaise = 0n;
    let receivedPaise = 0n;
    for (const l of statement.lines) {
      if (l.side === 'debit' && l.kind === 'client_invoice') invoicedPaise += l.amountPaise;
      if (l.side === 'credit' && l.kind === 'client_payment_received') {
        receivedPaise += l.amountPaise;
      }
    }
    return { invoicedPaise, receivedPaise };
  }, [statement]);

  const agingRow = aging?.row ?? null;

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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        <Kpi
          label="Invoiced (period)"
          value={periodTotals ? formatINR(periodTotals.invoicedPaise) : '—'}
        />
        <Kpi
          label="Received (period)"
          value={periodTotals ? formatINR(periodTotals.receivedPaise) : '—'}
        />
        <Kpi
          label="Outstanding today"
          value={aging ? formatINR(aging.row?.totalPaise ?? 0n) : '—'}
          sub="as of today"
        />
      </div>
      {agingRow ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {AGING_BUCKETS.map((b) => (
            <span key={b} className="pill" title={`Outstanding ${b} days old`}>
              {b} · {formatINR(agingRow.byBucket[b])}
            </span>
          ))}
        </div>
      ) : null}

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

// Inline KPI card — same styling as project-window's Kpi, kept local so this
// window doesn't grow a dependency on the project window.
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
        style={{ fontSize: 22, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{sub}</div> : null}
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
