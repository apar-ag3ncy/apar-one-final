'use client';

// Per-Client P&L OS window — LEDGER-SPEC §5 (the headline ledger UI).
//
// Wraps the same getPerClientPnL server action the Dashboard report uses,
// but inside OS window chrome:
//   - From / To date pickers (default: current FY → today, IST)
//   - DataTable: Client / Revenue / Direct cost / Gross margin / Margin %
//   - Click a client row → opens that client's window beside-focused
//     with the Transactions tab pre-selected
//   - PDF / Excel export
//
// Money rendered through formatINR (CLAUDE rule #1).

import { useEffect, useMemo, useState } from 'react';

import { DateField as SharedDateField } from '@/components/shared/date-field';
import { formatINR } from '@/components/shared/format-inr';
import { getPerClientPnL } from '@/lib/server-stub/ledger-actions';
import type { PerClientPnLRow } from '@/lib/server-stub/ledger-types';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import { navigateBesideFocused } from './navigate';
import { OsExportButtons } from './report-window-kit';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function PerClientPnLWindow() {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [rows, setRows] = useState<readonly PerClientPnLRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // queueMicrotask so the pending-state reset doesn't fire synchronously
    // inside the effect (react-hooks no-sync-render rule).
    queueMicrotask(() => {
      if (cancelled) return;
      setRows(null);
      setError(null);
    });
    getPerClientPnL({ fromDate, toDate })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load report');
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  const totals = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenuePaise,
        cost: acc.cost + r.directCostPaise,
        margin: acc.margin + r.grossMarginPaise,
        txns: acc.txns + r.txnCount,
      }),
      { revenue: 0n, cost: 0n, margin: 0n, txns: 0 },
    );
  }, [rows]);

  function handleExport(format: ExportFormat) {
    if (!rows) return;
    const headers = ['Client', 'Revenue', 'Direct Cost', 'Gross Margin', 'Margin %', 'Txns'];
    const marginPct = (margin: bigint, revenue: bigint): string =>
      revenue === 0n ? '' : `${(Number((margin * 10000n) / revenue) / 100).toFixed(1)}%`;
    const data: Record<string, string | number>[] = rows.map((r) => ({
      Client: r.clientName,
      Revenue: paiseToRupees(r.revenuePaise),
      'Direct Cost': paiseToRupees(r.directCostPaise),
      'Gross Margin': paiseToRupees(r.grossMarginPaise),
      'Margin %': marginPct(r.grossMarginPaise, r.revenuePaise),
      Txns: r.txnCount,
    }));
    if (totals) {
      data.push({
        Client: 'Totals',
        Revenue: paiseToRupees(totals.revenue),
        'Direct Cost': paiseToRupees(totals.cost),
        'Gross Margin': paiseToRupees(totals.margin),
        'Margin %': marginPct(totals.margin, totals.revenue),
        Txns: totals.txns,
      });
    }
    exportRows(data, headers, `per-client-pnl-${fromDate}-${toDate}`, format, 'Per-Client P&L');
  }

  function drillIntoClient(row: PerClientPnLRow) {
    // Open the client window beside with Transactions tab pre-selected.
    // Date range is not yet persisted across windows — the ClientWindow's
    // Transactions tab uses its own default filter today (BACKEND-STATE.md
    // notes the date-range plumbing as still missing).
    navigateBesideFocused({
      type: 'client',
      id: row.clientId,
      tab: 'transactions',
    });
  }

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
        <div style={{ flex: 1 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            Per-client P&amp;L
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Revenue, direct cost, gross margin — by client. Posted transactions only. Click a row to
            drill into that client&apos;s transactions.
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
        <OsExportButtons onExport={handleExport} disabled={!rows || rows.length === 0} />
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? (
          <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
        ) : !rows ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No revenue or cost in this range. Try expanding the date filter.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Direct cost</th>
                <th style={{ textAlign: 'right' }}>Gross margin</th>
                <th style={{ textAlign: 'right' }}>Margin %</th>
                <th style={{ textAlign: 'right' }}>Txns</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const positive = r.grossMarginPaise >= 0n;
                const pct =
                  r.revenuePaise === 0n
                    ? '—'
                    : `${(Number((r.grossMarginPaise * 10000n) / r.revenuePaise) / 100).toFixed(1)}%`;
                return (
                  <tr key={r.clientId} className="row-clickable" onClick={() => drillIntoClient(r)}>
                    <td>{r.clientName}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(r.revenuePaise)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(r.directCostPaise)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: positive ? 'var(--apar-green, #2E8F5A)' : 'var(--apar-red, #c33)',
                      }}
                    >
                      {formatINR(r.grossMarginPaise)}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {pct}
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.txnCount}
                    </td>
                  </tr>
                );
              })}
              {totals ? (
                <tr style={{ fontWeight: 600, background: 'var(--content-2)' }}>
                  <td>Totals</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(totals.revenue)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(totals.cost)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(totals.margin)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totals.revenue === 0n
                      ? '—'
                      : `${(Number((totals.margin * 10000n) / totals.revenue) / 100).toFixed(1)}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {totals.txns}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
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
      <SharedDateField value={value} onChange={onChange} clearable={false} className="w-[150px]" />
    </label>
  );
}
