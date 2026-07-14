'use client';

// Per-Project P&L — every project with activity in the range: revenue billed
// to the client (and received) vs vendor cost billed (and paid), with margin.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getProjectPnlAll, type ProjectPnl } from '@/lib/server/ledger/report-suite';
import { navigateBesideFocused } from './navigate';
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

type ProjectPnlSortKey = 'project' | 'billed' | 'received' | 'cost' | 'paid' | 'margin';

export function ProjectPnlWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<ProjectPnl>(
    () => getProjectPnlAll({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  const { sort, toggle } = useTableSort<ProjectPnlSortKey>();
  const sortedRows = useSortedRows(data?.rows ?? [], sort, {
    project: (r) => r.projectName,
    billed: (r) => r.billedPaise,
    received: (r) => r.receivedPaise,
    cost: (r) => r.costedPaise,
    paid: (r) => r.paidPaise,
    margin: (r) => r.marginPaise,
  });

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Project', 'Client', 'Billed', 'Received', 'Vendor cost', 'Paid', 'Margin'];
    const rows: Record<string, string | number>[] = [
      ...data.rows.map((r) => ({
        Project: r.projectName,
        Client: r.clientName ?? '',
        Billed: paiseToRupees(r.billedPaise),
        Received: paiseToRupees(r.receivedPaise),
        'Vendor cost': paiseToRupees(r.costedPaise),
        Paid: paiseToRupees(r.paidPaise),
        Margin: paiseToRupees(r.marginPaise),
      })),
      {
        Project: 'TOTAL',
        Client: '',
        Billed: paiseToRupees(data.totalBilledPaise),
        Received: paiseToRupees(data.totalReceivedPaise),
        'Vendor cost': paiseToRupees(data.totalCostedPaise),
        Paid: paiseToRupees(data.totalPaidPaise),
        Margin: paiseToRupees(data.totalMarginPaise),
      },
    ];
    exportRows(rows, headers, `project-pnl-${fromDate}-to-${toDate}`, format, 'Per-Project P&L', {
      columnFormats: { Margin: '+#,##0.00;-#,##0.00;0.00' },
    });
  }

  return (
    <ReportWindowFrame
      title="Per-Project P&L"
      subtitle="Revenue billed & received from the client vs vendor cost billed & paid, per project."
      error={error}
      loading={!data}
      isEmpty={!!data && data.rows.length === 0}
      emptyText="No project-tagged activity in this range."
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
          <DateField label="To" value={toDate} onChange={setToDate} />
          <OsExportButtons onExport={handleExport} disabled={!data || data.rows.length === 0} />
        </div>
      }
    >
      {data ? (
        <table className="table">
          <thead>
            <tr>
              <SortHeader label="Project" sortKey="project" sort={sort} onSort={toggle} />
              <SortHeader
                label="Billed"
                sortKey="billed"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="Received"
                sortKey="received"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="Vendor cost"
                sortKey="cost"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="Paid"
                sortKey="paid"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="Margin"
                sortKey="margin"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr
                key={r.projectId}
                style={{ cursor: 'pointer' }}
                onClick={() => navigateBesideFocused({ type: 'project', id: r.projectId })}
              >
                <td>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{r.projectName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {r.clientName ?? '—'}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(r.billedPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--apar-green, #2E8F5A)',
                  }}
                >
                  {formatINR(r.receivedPaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(r.costedPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--apar-red, #c33)',
                  }}
                >
                  {formatINR(r.paidPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                    color:
                      r.marginPaise >= 0n ? 'var(--apar-green, #2E8F5A)' : 'var(--apar-red, #c33)',
                  }}
                >
                  {formatINR(r.marginPaise)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td>TOTAL</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalBilledPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalReceivedPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalCostedPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalPaidPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalMarginPaise)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}
