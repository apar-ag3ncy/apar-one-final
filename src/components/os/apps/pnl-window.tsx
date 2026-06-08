'use client';

// Profit & Loss — native OS window. Derived from the trial balance exactly
// like /reports/pnl: revenue = 4xxx (credit−debit), direct cost = 5xxx
// (debit−credit), opex = 6xxx (debit−credit). Cost/opex lines display as
// negative amounts; gross & net profit are the running subtotals.

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

type Line = { code: string; name: string; balance: bigint };

function lines(rows: readonly TrialBalanceRow[], prefix: string, sign: 'debit' | 'credit'): Line[] {
  return rows
    .filter((r) => r.accountCode.startsWith(prefix))
    .map((r) => ({
      code: r.accountCode,
      name: r.accountName,
      balance: sign === 'credit' ? r.creditPaise - r.debitPaise : r.debitPaise - r.creditPaise,
    }));
}

export function PnLWindow() {
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [includeReversed, setIncludeReversed] = useState<boolean>(false);

  const { data: rows, error } = useReportData<readonly TrialBalanceRow[]>(
    () => getTrialBalance({ asOfDate, includeReversed }),
    [asOfDate, includeReversed],
  );

  const model = useMemo(() => {
    if (!rows) return null;
    const revenue = lines(rows, '4', 'credit');
    const directCost = lines(rows, '5', 'debit');
    const opex = lines(rows, '6', 'debit');
    const sum = (l: Line[]) => l.reduce((s, r) => s + r.balance, 0n);
    const totalRevenue = sum(revenue);
    const totalCogs = sum(directCost);
    const grossProfit = totalRevenue - totalCogs;
    const totalOpex = sum(opex);
    const netProfit = grossProfit - totalOpex;
    return { revenue, directCost, opex, totalRevenue, grossProfit, netProfit };
  }, [rows]);

  function handleExport(format: ExportFormat) {
    if (!model) return;
    const headers = ['Section', 'Code', 'Account', 'Amount'];
    const data: Record<string, string | number>[] = [];
    const push = (section: string, code: string, account: string, amount: bigint) =>
      data.push({ Section: section, Code: code, Account: account, Amount: paiseToRupees(amount) });
    for (const r of model.revenue) push('Revenue', r.code, r.name, r.balance);
    push('Revenue', '', 'Total revenue', model.totalRevenue);
    for (const r of model.directCost) push('Direct cost', r.code, r.name, -r.balance);
    push('', '', 'Gross profit', model.grossProfit);
    for (const r of model.opex) push('Operating expenses', r.code, r.name, -r.balance);
    push('', '', 'Net profit', model.netProfit);
    exportRows(data, headers, `pnl-${asOfDate}`, format, 'Profit & Loss');
  }

  const isEmpty = !!rows && rows.length === 0;

  return (
    <ReportWindowFrame
      title="Profit & Loss"
      subtitle="Revenue − direct cost = gross profit. Gross profit − OpEx = net profit. From the trial balance."
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
          <OsExportButtons onExport={handleExport} disabled={!model || isEmpty} />
        </>
      }
      loading={!rows && !error}
      error={error}
      isEmpty={isEmpty}
      emptyText="No income or expense in this period."
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
            <SectionHeader label="Revenue (4xxx)" />
            {model.revenue.map((r) => (
              <LineRow key={r.code} code={r.code} name={r.name} amount={r.balance} />
            ))}
            <SubtotalRow label="Total revenue" amount={model.totalRevenue} />

            <SectionHeader label="Direct cost (5xxx)" />
            {model.directCost.map((r) => (
              <LineRow key={r.code} code={r.code} name={r.name} amount={-r.balance} />
            ))}
            <SubtotalRow label="Gross profit" amount={model.grossProfit} highlight />

            <SectionHeader label="Operating expenses (6xxx)" />
            {model.opex.map((r) => (
              <LineRow key={r.code} code={r.code} name={r.name} amount={-r.balance} />
            ))}
            <SubtotalRow label="Net profit" amount={model.netProfit} highlight />
          </tbody>
        </table>
      ) : null}
    </ReportWindowFrame>
  );
}

function LineRow({ code, name, amount }: { code: string; name: string; amount: bigint }) {
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
          {code}
        </span>
        <span style={{ marginLeft: 8 }}>{name}</span>
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(amount)}
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
