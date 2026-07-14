'use client';

// Day Book — the general journal. Every posting in the range, in date order,
// with account + debit/credit. Debits total to credits (double-entry).

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getDayBook, type DayBook } from '@/lib/server/ledger/report-suite';
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

type DayBookSortKey = 'date' | 'particulars' | 'account' | 'debit' | 'credit';

export function DayBookWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<DayBook>(
    () => getDayBook({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  const { sort, toggle } = useTableSort<DayBookSortKey>();
  const sortedRows = useSortedRows(data?.rows ?? [], sort, {
    date: (r) => r.txnDate,
    particulars: (r) => r.description ?? r.reference,
    account: (r) => r.accountName,
    debit: (r) => r.debitPaise,
    credit: (r) => r.creditPaise,
  });

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Date', 'Particulars', 'Kind', 'Account code', 'Account', 'Debit', 'Credit'];
    const rows: Record<string, string | number>[] = data.rows.map((r) => ({
      Date: r.txnDate.slice(0, 10),
      Particulars: r.description ?? r.reference,
      Kind: r.kind.replace(/_/g, ' '),
      'Account code': r.accountCode,
      Account: r.accountName,
      Debit: r.debitPaise > 0n ? paiseToRupees(r.debitPaise) : 0,
      Credit: r.creditPaise > 0n ? paiseToRupees(r.creditPaise) : 0,
    }));
    exportRows(rows, headers, `day-book-${fromDate}-to-${toDate}`, format, 'Day Book');
  }

  return (
    <ReportWindowFrame
      title="Day Book"
      subtitle="General journal — every posting in the range, in date order."
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
        <>
          {data.truncated ? (
            <p style={{ fontSize: 11, color: 'var(--apar-amber, #d08a1e)', marginBottom: 8 }}>
              Showing the first 3,000 entries — narrow the date range to see the rest.
            </p>
          ) : null}
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Date" sortKey="date" sort={sort} onSort={toggle} />
                <SortHeader label="Particulars" sortKey="particulars" sort={sort} onSort={toggle} />
                <SortHeader label="Account" sortKey="account" sort={sort} onSort={toggle} />
                <SortHeader
                  label="Debit"
                  sortKey="debit"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
                <SortHeader
                  label="Credit"
                  sortKey="credit"
                  sort={sort}
                  onSort={toggle}
                  align="right"
                  style={{ textAlign: 'right' }}
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr
                  key={`${r.txnId}-${i}`}
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
                  <td>
                    <div style={{ fontSize: 12 }}>{r.description ?? r.reference}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      {r.kind.replace(/_/g, ' ')}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 12 }}>{r.accountName}</span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-jetbrains-mono, monospace)',
                        marginLeft: 6,
                      }}
                    >
                      {r.accountCode}
                    </span>
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: r.debitPaise > 0n ? 'var(--text)' : 'var(--text-dim)',
                    }}
                  >
                    {r.debitPaise > 0n ? formatINR(r.debitPaise) : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: r.creditPaise > 0n ? 'var(--text)' : 'var(--text-dim)',
                    }}
                  >
                    {r.creditPaise > 0n ? formatINR(r.creditPaise) : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td colSpan={3}>Total</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalDebitPaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalCreditPaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </ReportWindowFrame>
  );
}
