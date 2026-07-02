'use client';

// GST Summary — output GST collected (2120) vs input GST credit (1250) per
// month, and net payable = output − input.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import { getGstSummary, type GstSummary } from '@/lib/server/ledger/report-suite';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  currentFyDefaults,
  exportRows,
  useReportData,
  type ExportFormat,
} from './report-window-kit';

function monthLabel(m: string): string {
  const [y, mo] = m.split('-');
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function GstSummaryWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);

  const { data, error } = useReportData<GstSummary>(
    () => getGstSummary({ from: fromDate, to: toDate }),
    [fromDate, toDate],
  );

  function handleExport(format: ExportFormat) {
    if (!data) return;
    const headers = ['Month', 'Output GST', 'Input GST', 'Net payable'];
    const rows: Record<string, string | number>[] = [
      ...data.rows.map((r) => ({
        Month: monthLabel(r.month),
        'Output GST': paiseToRupees(r.outputPaise),
        'Input GST': paiseToRupees(r.inputPaise),
        'Net payable': paiseToRupees(r.netPayablePaise),
      })),
      {
        Month: 'TOTAL',
        'Output GST': paiseToRupees(data.totalOutputPaise),
        'Input GST': paiseToRupees(data.totalInputPaise),
        'Net payable': paiseToRupees(data.netPayablePaise),
      },
    ];
    exportRows(rows, headers, `gst-summary-${fromDate}-to-${toDate}`, format, 'GST Summary', {
      columnFormats: { 'Net payable': '+#,##0.00;-#,##0.00;0.00' },
    });
  }

  return (
    <ReportWindowFrame
      title="GST Summary"
      subtitle="Output GST (2120) vs input credit (1250), by month. Positive net = GST owed to the department."
      error={error}
      loading={!data}
      isEmpty={!!data && data.rows.length === 0}
      emptyText="No GST recorded in this range."
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
            <Kpi label="Output GST" value={formatINR(data.totalOutputPaise)} />
            <Kpi label="Input credit" value={formatINR(data.totalInputPaise)} />
            <Kpi label="Net payable" value={formatINR(data.netPayablePaise)} strong />
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Output GST</th>
                <th style={{ textAlign: 'right' }}>Input GST</th>
                <th style={{ textAlign: 'right' }}>Net payable</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(r.outputPaise)}
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(r.inputPaise)}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color:
                        r.netPayablePaise > 0n
                          ? 'var(--apar-red, #c33)'
                          : 'var(--apar-green, #2E8F5A)',
                    }}
                  >
                    {formatINR(r.netPayablePaise)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <td>TOTAL</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalOutputPaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.totalInputPaise)}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(data.netPayablePaise)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </ReportWindowFrame>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
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
        style={{ fontSize: strong ? 22 : 18, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}
