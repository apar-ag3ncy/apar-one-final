'use client';

// TDS Summary — TDS receivable (1260, withheld by clients from our receipts)
// vs TDS payable (2130, withheld by us from vendor payments), by month.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getTdsSummary, type TdsSummary } from '@/lib/server/ledger/report-suite';
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

type TdsSortKey = 'month' | 'receivable' | 'payable';

function monthLabel(m: string): string {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

export function TdsSummaryWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<TdsSummary>(
    () => getTdsSummary({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  const { sort, toggle } = useTableSort<TdsSortKey>();
  const sortedRows = useSortedRows(data?.rows ?? [], sort, {
    month: (r) => r.month,
    receivable: (r) => r.receivablePaise,
    payable: (r) => r.payablePaise,
  });

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Month', 'TDS receivable', 'TDS payable'];
    const rows: Record<string, string | number>[] = [
      ...data.rows.map((r) => ({
        Month: monthLabel(r.month),
        'TDS receivable': paiseToRupees(r.receivablePaise),
        'TDS payable': paiseToRupees(r.payablePaise),
      })),
      {
        Month: 'TOTAL',
        'TDS receivable': paiseToRupees(data.totalReceivablePaise),
        'TDS payable': paiseToRupees(data.totalPayablePaise),
      },
    ];
    exportRows(rows, headers, `tds-summary-${fromDate}-to-${toDate}`, format, 'TDS Summary');
  }

  return (
    <ReportWindowFrame
      title="TDS Summary"
      subtitle="TDS receivable (1260, withheld by clients) vs TDS payable (2130, withheld by us), by month."
      error={error}
      loading={!data}
      isEmpty={!!data && data.rows.length === 0}
      emptyText="No TDS recorded in this range."
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
          <DateField label="To" value={toDate} onChange={setToDate} />
          <OsExportButtons onExport={handleExport} disabled={!data || data.rows.length === 0} />
        </div>
      }
    >
      {data ? (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
            <Kpi label="TDS receivable" value={formatINR(data.totalReceivablePaise)} />
            <Kpi label="TDS payable" value={formatINR(data.totalPayablePaise)} />
          </div>
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Month" sortKey="month" sort={sort} onSort={toggle} />
                <SortHeader
                  label="TDS receivable"
                  sortKey="receivable"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
                <SortHeader
                  label="TDS payable"
                  sortKey="payable"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--apar-green, #2E8F5A)',
                    }}
                  >
                    {formatINR(r.receivablePaise)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--apar-red, #c33)',
                    }}
                  >
                    {formatINR(r.payablePaise)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td>TOTAL</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalReceivablePaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalPayablePaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </ReportWindowFrame>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
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
        style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}
