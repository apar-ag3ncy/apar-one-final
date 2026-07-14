'use client';

// Sales Register / Purchase Register — every client invoice / vendor bill in
// the range with taxable value, GST, total, party & project. Shared body.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import {
  getPurchaseRegister,
  getSalesRegister,
  type Register,
} from '@/lib/server/ledger/report-suite';
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

type RegisterSortKey = 'date' | 'doc' | 'party' | 'project' | 'taxable' | 'gst' | 'total';

function RegisterWindow({
  title,
  subtitle,
  partyLabel,
  docLabel,
  fetcher,
  fileBase,
}: {
  title: string;
  subtitle: string;
  partyLabel: string;
  docLabel: string;
  fetcher: (args: { from: string; to: string }) => Promise<Register>;
  fileBase: string;
}) {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<Register>(
    () => fetcher({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  const { sort, toggle } = useTableSort<RegisterSortKey>();
  const sortedRows = useSortedRows(data?.rows ?? [], sort, {
    date: (r) => r.txnDate,
    doc: (r) => r.documentNumber,
    party: (r) => r.partyName,
    project: (r) => r.projectName,
    taxable: (r) => r.taxablePaise,
    gst: (r) => r.gstPaise,
    total: (r) => r.totalPaise,
  });

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Date', docLabel, partyLabel, 'Project', 'Status', 'Taxable', 'GST', 'Total'];
    const rows: Record<string, string | number>[] = [
      ...data.rows.map((r) => ({
        Date: r.txnDate.slice(0, 10),
        [docLabel]: r.documentNumber,
        [partyLabel]: r.partyName ?? '',
        Project: r.projectName ?? '',
        Status: r.status,
        Taxable: paiseToRupees(r.taxablePaise),
        GST: paiseToRupees(r.gstPaise),
        Total: paiseToRupees(r.totalPaise),
      })),
      {
        Date: '',
        [docLabel]: 'TOTAL',
        [partyLabel]: '',
        Project: '',
        Status: '',
        Taxable: paiseToRupees(data.totalTaxablePaise),
        GST: paiseToRupees(data.totalGstPaise),
        Total: paiseToRupees(data.totalPaise),
      },
    ];
    exportRows(rows, headers, `${fileBase}-${fromDate}-to-${toDate}`, format, title);
  }

  return (
    <ReportWindowFrame
      title={title}
      subtitle={subtitle}
      error={error}
      loading={!data}
      isEmpty={!!data && data.rows.length === 0}
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
              <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} />
              <SortHeader label={docLabel} sortKey="doc" sort={sort} onSort={toggle} />
              <SortHeader label={partyLabel} sortKey="party" sort={sort} onSort={toggle} />
              <SortHeader label="Project" sortKey="project" sort={sort} onSort={toggle} />
              <SortHeader
                label="Taxable"
                sortKey="taxable"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="GST"
                sortKey="gst"
                sort={sort}
                onSort={toggle}
                align="right"
                style={{ textAlign: 'right' }}
              />
              <SortHeader
                label="Total"
                sortKey="total"
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
                key={r.txnId}
                style={{ cursor: 'pointer' }}
                onClick={() => navigateBesideFocused({ type: 'transaction', id: r.txnId })}
              >
                <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(r.txnDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: '2-digit',
                  })}
                </td>
                <td style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', fontSize: 11.5 }}>
                  {r.documentNumber}
                  {r.status !== 'posted' ? (
                    <span
                      className="pill amber"
                      style={{ marginLeft: 8, fontSize: 9.5, padding: '1px 7px' }}
                      title="Recorded but not posted to the books yet — post it from the Bills/Invoices tab."
                    >
                      Draft
                    </span>
                  ) : null}
                </td>
                <td>{r.partyName ?? '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.projectName ?? '—'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(r.taxablePaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(r.gstPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {formatINR(r.totalPaise)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td colSpan={4}>TOTAL</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalTaxablePaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalGstPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.totalPaise)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}

export function SalesRegisterWindow() {
  return (
    <RegisterWindow
      title="Sales Register"
      subtitle="Every client invoice raised in the range — taxable value, GST, total."
      partyLabel="Client"
      docLabel="Invoice no."
      fetcher={getSalesRegister}
      fileBase="sales-register"
    />
  );
}

export function PurchaseRegisterWindow() {
  return (
    <RegisterWindow
      title="Purchase Register"
      subtitle="Every vendor bill recorded in the range — taxable value, GST, total."
      partyLabel="Vendor"
      docLabel="Bill no."
      fetcher={getPurchaseRegister}
      fileBase="purchase-register"
    />
  );
}
