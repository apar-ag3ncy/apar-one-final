'use client';

// Bank Book — per account. A passbook for one agency bank account: brought-
// forward balance, dated money-in / money-out movements, running balance,
// closing KPI. Pick the account + date range; export to PDF/Excel.

import { useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import { getBankBook, type BankBook } from '@/lib/server/ledger/statements';
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

export function BankBookWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);
  const [bankId, setBankId] = useState<string>('');

  const { data: banks } = useReportData<readonly AgencyBankAccountRow[]>(
    () => listAgencyBankAccounts(),
    [],
  );
  const selectedId = bankId || banks?.[0]?.id || '';
  const selected = banks?.find((b) => b.id === selectedId);

  const { data: book, error } = useReportData<BankBook | null>(
    () =>
      selectedId
        ? getBankBook({ bankAccountId: selectedId, from: fromDate, to: toDate })
        : Promise.resolve(null),
    [selectedId, fromDate, toDate],
  );

  const label = selected
    ? `${selected.label} · ${selected.bankName} ••${selected.accountLast4}`
    : '';

  function handleExport(format: ExportFormat) {
    if (!book) return;
    const headers = ['Date', 'Particulars', 'Money in', 'Money out', 'Balance'];
    const rows: Record<string, string | number>[] = [
      {
        Date: '',
        Particulars: `Brought forward (before ${fromDate})`,
        'Money in': '',
        'Money out': '',
        Balance: paiseToRupees(book.openingCarryPaise),
      },
      ...book.lines.map((l) => ({
        Date: l.txnDate.slice(0, 10),
        Particulars: l.documentNumber ?? l.description ?? l.reference,
        'Money in': l.side === 'debit' ? paiseToRupees(l.amountPaise) : 0,
        'Money out': l.side === 'credit' ? paiseToRupees(l.amountPaise) : 0,
        Balance: paiseToRupees(l.runningBalancePaise),
      })),
    ];
    exportRows(
      rows,
      headers,
      `bank-book-${selected?.accountLast4 ?? 'account'}-${fromDate}-to-${toDate}`,
      format,
      'Bank Book',
      {
        columnFormats: { Balance: '+#,##0.00;-#,##0.00;0.00' },
      },
    );
  }

  return (
    <ReportWindowFrame
      title="Bank Book"
      subtitle={label ? `Passbook for ${label}` : 'Per-account bank passbook.'}
      error={error}
      loading={!banks}
      isEmpty={!!book && book.lines.length === 0}
      emptyText="No movements in this range for this account."
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Bank account
            </span>
            <select
              value={selectedId}
              onChange={(e) => setBankId(e.target.value)}
              style={{
                background: 'var(--content-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 12,
                color: 'var(--text)',
              }}
            >
              {(banks ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} · {b.bankName} ••{b.accountLast4}
                  {b.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </label>
          <DateField label="From" value={fromDate} onChange={setFromDate} />
          <DateField label="To" value={toDate} onChange={setToDate} />
          <OsExportButtons onExport={handleExport} disabled={!book || book.lines.length === 0} />
        </div>
      }
    >
      {book ? (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, flexWrap: 'wrap' }}>
            <Kpi label="Opening" value={formatINR(book.openingCarryPaise)} />
            <Kpi label="Closing" value={formatINR(book.closingBalancePaise)} strong />
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Particulars</th>
                <th style={{ textAlign: 'right' }}>Money in</th>
                <th style={{ textAlign: 'right' }}>Money out</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ color: 'var(--text-muted)' }}>—</td>
                <td style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Brought forward (before {fromDate})
                </td>
                <td /> <td />
                <td
                  style={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {formatINR(book.openingCarryPaise)}
                </td>
              </tr>
              {book.lines.map((l) => (
                <tr
                  key={l.postingId}
                  style={{ cursor: 'pointer', opacity: l.status === 'draft' ? 0.7 : 1 }}
                  onClick={() => navigateBesideFocused({ type: 'transaction', id: l.txnId })}
                >
                  <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(l.txnDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </td>
                  <td>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>
                      {l.documentNumber ?? l.description ?? l.reference}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {l.counterpartyName ? `${l.counterpartyName} · ` : ''}
                      {l.kind.replace(/_/g, ' ')}
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: l.side === 'debit' ? 'var(--apar-green, #2E8F5A)' : 'var(--text-dim)',
                    }}
                  >
                    {l.side === 'debit' ? formatINR(l.amountPaise) : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: l.side === 'credit' ? 'var(--apar-red, #c33)' : 'var(--text-dim)',
                    }}
                  >
                    {l.side === 'credit' ? formatINR(l.amountPaise) : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                    }}
                  >
                    {formatINR(l.runningBalancePaise)}
                  </td>
                </tr>
              ))}
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
