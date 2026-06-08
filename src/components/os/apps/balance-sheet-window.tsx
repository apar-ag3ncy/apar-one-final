'use client';

// Balance Sheet — native OS window. Derived from the trial balance exactly
// like the dashboard /reports/balance-sheet route: assets = 1xxx
// (debit−credit), liabilities = 2xxx and equity = 3xxx (credit−debit).

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

type Line = { code: string; name: string; amount: bigint };

function section(
  rows: readonly TrialBalanceRow[],
  prefix: string,
  sign: 'debit' | 'credit',
): Line[] {
  return rows
    .filter((r) => r.accountCode.startsWith(prefix))
    .map((r) => ({
      code: r.accountCode,
      name: r.accountName,
      amount: sign === 'debit' ? r.debitPaise - r.creditPaise : r.creditPaise - r.debitPaise,
    }));
}

export function BalanceSheetWindow() {
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());

  const { data: rows, error } = useReportData<readonly TrialBalanceRow[]>(
    () => getTrialBalance({ asOfDate }),
    [asOfDate],
  );

  const model = useMemo(() => {
    if (!rows) return null;
    const assets = section(rows, '1', 'debit');
    const liabilities = section(rows, '2', 'credit');
    const equity = section(rows, '3', 'credit');
    const sum = (l: Line[]) => l.reduce((s, r) => s + r.amount, 0n);
    return {
      assets,
      liabilities,
      equity,
      totalAssets: sum(assets),
      totalLiab: sum(liabilities),
      totalEquity: sum(equity),
    };
  }, [rows]);

  function handleExport(format: ExportFormat) {
    if (!model) return;
    const headers = ['Section', 'Code', 'Account', 'Amount'];
    const data: Record<string, string | number>[] = [];
    const pushSection = (label: string, lines: Line[]) => {
      for (const l of lines)
        data.push({
          Section: label,
          Code: l.code,
          Account: l.name,
          Amount: paiseToRupees(l.amount),
        });
    };
    pushSection('Assets', model.assets);
    data.push({
      Section: 'Assets',
      Code: '',
      Account: 'Total assets',
      Amount: paiseToRupees(model.totalAssets),
    });
    pushSection('Liabilities', model.liabilities);
    data.push({
      Section: 'Liabilities',
      Code: '',
      Account: 'Total liabilities',
      Amount: paiseToRupees(model.totalLiab),
    });
    pushSection('Equity', model.equity);
    data.push({
      Section: 'Equity',
      Code: '',
      Account: 'Total equity',
      Amount: paiseToRupees(model.totalEquity),
    });
    data.push({
      Section: '',
      Code: '',
      Account: 'Liabilities + Equity',
      Amount: paiseToRupees(model.totalLiab + model.totalEquity),
    });
    exportRows(data, headers, `balance-sheet-${asOfDate}`, format, 'Balance Sheet');
  }

  const isEmpty = !!rows && rows.length === 0;

  return (
    <ReportWindowFrame
      title="Balance Sheet"
      subtitle="Assets = Liabilities + Equity, from posted GL balances as of the chosen date."
      controls={
        <>
          <DateField label="As of" value={asOfDate} onChange={setAsOfDate} />
          <OsExportButtons onExport={handleExport} disabled={!model || isEmpty} />
        </>
      }
      loading={!rows && !error}
      error={error}
      isEmpty={isEmpty}
      emptyText="No balances as of this date."
    >
      {model ? (
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Assets (1xxx)" />
            {model.assets.map((r) => (
              <LineRow key={r.code} line={r} />
            ))}
            <SubtotalRow label="Total assets" amount={model.totalAssets} highlight />

            <SectionHeader label="Liabilities (2xxx)" />
            {model.liabilities.map((r) => (
              <LineRow key={r.code} line={r} />
            ))}
            <SubtotalRow label="Total liabilities" amount={model.totalLiab} />

            <SectionHeader label="Equity (3xxx)" />
            {model.equity.map((r) => (
              <LineRow key={r.code} line={r} />
            ))}
            <SubtotalRow label="Total equity" amount={model.totalEquity} />
            <SubtotalRow
              label="Liabilities + Equity"
              amount={model.totalLiab + model.totalEquity}
              highlight
            />
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}

function LineRow({ line }: { line: Line }) {
  return (
    <tr>
      <td>
        <span
          style={{
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
            fontSize: 11.5,
            color: 'var(--text-muted)',
          }}
        >
          {line.code}
        </span>
        <span style={{ marginLeft: 8 }}>{line.name}</span>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(line.amount)}
      </td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr style={{ background: 'var(--content-2)' }}>
      <td
        colSpan={2}
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </td>
    </tr>
  );
}

function SubtotalRow({
  label,
  amount,
  highlight,
}: {
  label: string;
  amount: bigint;
  highlight?: boolean;
}) {
  return (
    <tr style={highlight ? { fontWeight: 600, background: 'var(--content-2)' } : undefined}>
      <td>{label}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {formatINR(amount)}
      </td>
    </tr>
  );
}
