'use client';

// AR / AP Aging — native OS window. Same getAgingReport server action as the
// dashboard /reports/{ar,ap}-aging routes. Buckets 0-30 / 31-60 / 61-90 / 90+.
// Click a row to open that client/vendor beside-focused. (AP aging has no
// backend yet — it surfaces an honest empty state rather than fake numbers.)

import { useMemo, useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { getAgingReport } from '@/lib/server-stub/ledger-actions';
import type { AgingRow } from '@/lib/server-stub/ledger-types';
import { paiseToRupees } from '@/lib/client/export-rows';
import { navigateBesideFocused } from './navigate';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  exportRows,
  todayIso,
  useReportData,
  type ExportFormat,
} from './report-window-kit';

const BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;

export function AgingWindow({ side }: { side: 'receivable' | 'payable' }) {
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const entityLabel = side === 'receivable' ? 'Client' : 'Vendor';
  const entityType = side === 'receivable' ? 'client' : 'vendor';

  const { data: rows, error } = useReportData<readonly AgingRow[]>(
    () => getAgingReport({ side, asOfDate }),
    [side, asOfDate],
  );

  const totals = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (acc, r) => ({
        '0-30': acc['0-30'] + r.byBucket['0-30'],
        '31-60': acc['31-60'] + r.byBucket['31-60'],
        '61-90': acc['61-90'] + r.byBucket['61-90'],
        '90+': acc['90+'] + r.byBucket['90+'],
        total: acc.total + r.totalPaise,
      }),
      { '0-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n, total: 0n },
    );
  }, [rows]);

  function handleExport(format: ExportFormat) {
    if (!rows) return;
    const headers = [entityLabel, ...BUCKETS, 'Total'];
    const data: Record<string, string | number>[] = rows.map((r) => ({
      [entityLabel]: r.entityName,
      '0-30': paiseToRupees(r.byBucket['0-30']),
      '31-60': paiseToRupees(r.byBucket['31-60']),
      '61-90': paiseToRupees(r.byBucket['61-90']),
      '90+': paiseToRupees(r.byBucket['90+']),
      Total: paiseToRupees(r.totalPaise),
    }));
    if (totals) {
      data.push({
        [entityLabel]: 'Totals',
        '0-30': paiseToRupees(totals['0-30']),
        '31-60': paiseToRupees(totals['31-60']),
        '61-90': paiseToRupees(totals['61-90']),
        '90+': paiseToRupees(totals['90+']),
        Total: paiseToRupees(totals.total),
      });
    }
    exportRows(
      data,
      headers,
      `${side === 'receivable' ? 'ar' : 'ap'}-aging-${asOfDate}`,
      format,
      side === 'receivable' ? 'AR Aging' : 'AP Aging',
    );
  }

  const isEmpty = !!rows && rows.length === 0;

  return (
    <ReportWindowFrame
      title={side === 'receivable' ? 'AR Aging' : 'AP Aging'}
      subtitle={
        side === 'receivable'
          ? 'Outstanding receivables by age. Click a client to open its ledger beside.'
          : 'Outstanding payables by age. (AP aging lands with bill allocations — empty until then.)'
      }
      controls={
        <>
          <DateField label="As of" value={asOfDate} onChange={setAsOfDate} />
          <OsExportButtons onExport={handleExport} disabled={isEmpty} />
        </>
      }
      loading={!rows && !error}
      error={error}
      isEmpty={isEmpty}
      emptyText={
        side === 'receivable'
          ? 'No outstanding receivables as of this date.'
          : 'No AP aging data yet — this report activates once bill allocations ship.'
      }
    >
      {rows ? (
        <table className="table">
          <thead>
            <tr>
              <th>{entityLabel}</th>
              {BUCKETS.map((b) => (
                <th key={b} style={{ textAlign: 'right' }}>
                  {b} d
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.entityId}
                className="row-clickable"
                onClick={() => navigateBesideFocused({ type: entityType, id: r.entityId })}
              >
                <td>{r.entityName}</td>
                {BUCKETS.map((b) => (
                  <td key={b} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {r.byBucket[b] > 0n ? formatINR(r.byBucket[b]) : '—'}
                  </td>
                ))}
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 500,
                  }}
                >
                  {formatINR(r.totalPaise)}
                </td>
              </tr>
            ))}
            {totals ? (
              <tr style={{ fontWeight: 600, background: 'var(--content-2)' }}>
                <td>Totals</td>
                {BUCKETS.map((b) => (
                  <td key={b} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatINR(totals[b])}
                  </td>
                ))}
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(totals.total)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}
