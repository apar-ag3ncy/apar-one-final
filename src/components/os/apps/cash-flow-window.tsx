'use client';

// Cash Flow — native OS window. Direct-method: net movement of cash + bank
// (1110 + 1120) over the range, grouped by transaction kind, with opening and
// closing cash positions. Backed by getCashFlowStatement.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getCashFlowStatement, type CashFlowStatement } from '@/lib/server/ledger/report-suite';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  currentFyDefaults,
  exportRows,
  useReportData,
  type ExportFormat,
} from './report-window-kit';
import { SortHeader, useSortedRows, useTableSort } from './table-sort';

function kindLabel(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CashFlowWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<CashFlowStatement>(
    () => getCashFlowStatement({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  // Sort the category rows only; the Opening/Closing balance rows stay pinned.
  const { sort, toggle } = useTableSort<'category' | 'in' | 'out' | 'net'>();
  const sortedRows = useSortedRows(data?.rows ?? [], sort, {
    category: (r) => kindLabel(r.kind),
    in: (r) => r.inflowPaise,
    out: (r) => r.outflowPaise,
    net: (r) => r.netPaise,
  });

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Category', 'Money in', 'Money out', 'Net'];
    const rows: Record<string, string | number>[] = [
      {
        Category: `Opening cash & bank (before ${fromDate})`,
        'Money in': '',
        'Money out': '',
        Net: paiseToRupees(data.openingPaise),
      },
      ...data.rows.map((r) => ({
        Category: kindLabel(r.kind),
        'Money in': paiseToRupees(r.inflowPaise),
        'Money out': paiseToRupees(r.outflowPaise),
        Net: paiseToRupees(r.netPaise),
      })),
      {
        Category: 'Net movement',
        'Money in': paiseToRupees(data.totalInflowPaise),
        'Money out': paiseToRupees(data.totalOutflowPaise),
        Net: paiseToRupees(data.totalInflowPaise - data.totalOutflowPaise),
      },
      {
        Category: 'Closing cash & bank',
        'Money in': '',
        'Money out': '',
        Net: paiseToRupees(data.closingPaise),
      },
    ];
    exportRows(rows, headers, `cash-flow-${fromDate}-to-${toDate}`, format, 'Cash Flow', {
      columnFormats: { Net: '+#,##0.00;-#,##0.00;0.00' },
    });
  }

  return (
    <ReportWindowFrame
      title="Cash Flow"
      subtitle="Direct method — cash + bank (1110 + 1120) movement by category."
      error={error}
      loading={!data}
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
          <DateField label="To" value={toDate} onChange={setToDate} />
          <OsExportButtons onExport={handleExport} disabled={!data} />
        </div>
      }
    >
      {data ? (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
            <Kpi label="Opening" value={formatINR(data.openingPaise)} />
            <Kpi label="Money in" value={formatINR(data.totalInflowPaise)} tone="green" />
            <Kpi label="Money out" value={formatINR(data.totalOutflowPaise)} tone="red" />
            <Kpi label="Closing" value={formatINR(data.closingPaise)} strong />
          </div>
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Category" sortKey="category" sort={sort} onSort={toggle} />
                <SortHeader
                  label="Money in"
                  sortKey="in"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
                <SortHeader
                  label="Money out"
                  sortKey="out"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
                <SortHeader
                  label="Net"
                  sortKey="net"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                  Opening cash &amp; bank (before {fromDate})
                </td>
                <td /> <td />
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {formatINR(data.openingPaise)}
                </td>
              </tr>
              {sortedRows.map((r) => (
                <tr key={r.kind}>
                  <td>{kindLabel(r.kind)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: r.inflowPaise > 0n ? 'var(--apar-green, #2E8F5A)' : 'var(--text-dim)',
                    }}
                  >
                    {r.inflowPaise > 0n ? formatINR(r.inflowPaise) : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: r.outflowPaise > 0n ? 'var(--apar-red, #c33)' : 'var(--text-dim)',
                    }}
                  >
                    {r.outflowPaise > 0n ? formatINR(r.outflowPaise) : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                    }}
                  >
                    {formatINR(r.netPaise)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td>Closing cash &amp; bank</td>
                <td /> <td />
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.closingPaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </ReportWindowFrame>
  );
}

function Kpi({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'green' | 'red';
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
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
          fontSize: strong ? 22 : 18,
          fontVariantNumeric: 'tabular-nums',
          marginTop: 2,
          color:
            tone === 'green'
              ? 'var(--apar-green, #2E8F5A)'
              : tone === 'red'
                ? 'var(--apar-red, #c33)'
                : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
