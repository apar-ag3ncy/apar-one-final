'use client';

// Trial Balance — native OS window. Same getTrialBalance server action the
// dashboard /reports/trial-balance route uses, rendered in OS chrome with a
// live as-of date filter, include-reversed toggle, and PDF/Excel export.

import { useMemo, useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { getTrialBalance } from '@/lib/server-stub/ledger-actions';
import type { TrialBalanceRow } from '@/lib/server-stub/ledger-types';
import { paiseToRupees } from '@/lib/client/export-rows';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  exportRows,
  todayIso,
  useReportData,
  type ExportFormat,
} from './report-window-kit';
import { SortHeader, useSortedRows, useTableSort } from './table-sort';

export function TrialBalanceWindow() {
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [includeReversed, setIncludeReversed] = useState<boolean>(false);

  const { data: rows, error } = useReportData<readonly TrialBalanceRow[]>(
    () => getTrialBalance({ asOfDate, includeReversed }),
    [asOfDate, includeReversed],
  );

  const { sort, toggle } = useTableSort<'account' | 'debit' | 'credit'>();
  const sortedRows = useSortedRows(rows ?? [], sort, {
    account: (r) => r.accountCode,
    debit: (r) => r.debitPaise,
    credit: (r) => r.creditPaise,
  });

  const totals = useMemo(() => {
    if (!rows) return null;
    const debit = rows.reduce((s, r) => s + r.debitPaise, 0n);
    const credit = rows.reduce((s, r) => s + r.creditPaise, 0n);
    return { debit, credit, balanced: debit === credit };
  }, [rows]);

  function handleExport(format: ExportFormat) {
    if (!rows) return;
    const headers = ['Code', 'Account', 'Debit', 'Credit'];
    const data: Record<string, string | number>[] = rows.map((r) => ({
      Code: r.accountCode,
      Account: r.accountName,
      Debit: paiseToRupees(r.debitPaise),
      Credit: paiseToRupees(r.creditPaise),
    }));
    if (totals) {
      data.push({
        Code: '',
        Account: 'Totals',
        Debit: paiseToRupees(totals.debit),
        Credit: paiseToRupees(totals.credit),
      });
    }
    exportRows(data, headers, `trial-balance-${asOfDate}`, format, 'Trial Balance');
  }

  return (
    <ReportWindowFrame
      title="Trial Balance"
      subtitle="Debit & credit balances per account, as of the chosen date. Posted GL only."
      controls={
        <>
          <DateField label="As of" value={asOfDate} onChange={setAsOfDate} />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={includeReversed}
              onChange={(e) => setIncludeReversed(e.target.checked)}
            />
            Include reversed
          </label>
          <OsExportButtons onExport={handleExport} disabled={!rows || rows.length === 0} />
        </>
      }
      loading={!rows && !error}
      error={error}
      isEmpty={!!rows && rows.length === 0}
      emptyText="No account balances as of this date."
    >
      {rows ? (
        <table className="table">
          <thead>
            <tr>
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
            {sortedRows.map((r) => (
              <tr key={r.accountCode}>
                <td>
                  <span
                    style={{
                      fontFamily: 'var(--font-jetbrains-mono, monospace)',
                      fontSize: 11.5,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {r.accountCode}
                  </span>
                  <span style={{ marginLeft: 8 }}>{r.accountName}</span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.debitPaise > 0n ? formatINR(r.debitPaise) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {r.creditPaise > 0n ? formatINR(r.creditPaise) : '—'}
                </td>
              </tr>
            ))}
            {totals ? (
              <tr style={{ fontWeight: 600, background: 'var(--content-2)' }}>
                <td>
                  Totals
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      color: totals.balanced
                        ? 'var(--apar-green, #2E8F5A)'
                        : 'var(--apar-red, #c33)',
                    }}
                  >
                    {totals.balanced ? 'Balanced' : 'Unbalanced'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(totals.debit)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(totals.credit)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}
