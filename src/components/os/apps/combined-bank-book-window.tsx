'use client';

// Bank Book — all accounts (combined). One row per agency bank account:
// opening, money in, money out, closing; plus a grand-total row. The single
// "generate everything" bank overview across multiple accounts.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getCombinedBankBook, type CombinedBankBook } from '@/lib/server/ledger/report-suite';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  currentFyDefaults,
  exportRows,
  useReportData,
  type ExportFormat,
} from './report-window-kit';

export function CombinedBankBookWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<CombinedBankBook>(
    () => getCombinedBankBook({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Bank account', 'Opening', 'Money in', 'Money out', 'Closing'];
    const rows: Record<string, string | number>[] = [
      ...data.banks.map((b) => ({
        'Bank account': `${b.label} · ${b.bankName} ••${b.accountLast4}${b.isActive ? '' : ' (inactive)'}`,
        Opening: paiseToRupees(b.openingPaise),
        'Money in': paiseToRupees(b.inflowPaise),
        'Money out': paiseToRupees(b.outflowPaise),
        Closing: paiseToRupees(b.closingPaise),
      })),
      {
        'Bank account': 'GRAND TOTAL',
        Opening: paiseToRupees(data.grandOpeningPaise),
        'Money in': paiseToRupees(data.grandInflowPaise),
        'Money out': paiseToRupees(data.grandOutflowPaise),
        Closing: paiseToRupees(data.grandClosingPaise),
      },
    ];
    exportRows(
      rows,
      headers,
      `bank-book-all-accounts-${fromDate}-to-${toDate}`,
      format,
      'Bank Book (all accounts)',
      {
        columnFormats: { Closing: '+#,##0.00;-#,##0.00;0.00', Opening: '+#,##0.00;-#,##0.00;0.00' },
      },
    );
  }

  return (
    <ReportWindowFrame
      title="Bank Book — all accounts"
      subtitle="Every agency bank account: opening, movements, closing, with a grand total."
      error={error}
      loading={!data}
      isEmpty={!!data && data.banks.length === 0}
      emptyText="No bank accounts yet."
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
          <DateField label="To" value={toDate} onChange={setToDate} />
          <OsExportButtons onExport={handleExport} disabled={!data || data.banks.length === 0} />
        </div>
      }
    >
      {data ? (
        <table className="table">
          <thead>
            <tr>
              <th>Bank account</th>
              <th style={{ textAlign: 'right' }}>Opening</th>
              <th style={{ textAlign: 'right' }}>Money in</th>
              <th style={{ textAlign: 'right' }}>Money out</th>
              <th style={{ textAlign: 'right' }}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {data.banks.map((b) => (
              <tr key={b.bankAccountId}>
                <td>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>
                    {b.label}
                    {b.isActive ? null : (
                      <span
                        style={{ marginLeft: 6, fontSize: 10, color: 'var(--apar-amber, #d08a1e)' }}
                      >
                        inactive
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-jetbrains-mono, monospace)',
                    }}
                  >
                    {b.bankName} ••{b.accountLast4}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(b.openingPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--apar-green, #2E8F5A)',
                  }}
                >
                  {formatINR(b.inflowPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--apar-red, #c33)',
                  }}
                >
                  {formatINR(b.outflowPaise)}
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {formatINR(b.closingPaise)}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td>GRAND TOTAL</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.grandOpeningPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.grandInflowPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.grandOutflowPaise)}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(data.grandClosingPaise)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}
