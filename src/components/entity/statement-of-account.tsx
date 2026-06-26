'use client';

// Shared statement-of-account renderer used by the Ledger tab on Client
// and Vendor windows, plus the Office Ledger window. Renders the
// chronological postings table + the closing-balance KPI.
//
// Driven by `lib/server/ledger/statements.ts:Statement`. The Statement
// already carries the running balance per line — this component only
// formats and lays out.
//
// Theme: OS-native — uses `.table` + CSS variables so it slots into
// every Window without a shadcn / Tailwind dependency.

import { formatINR } from '@/components/shared/format-inr';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import type { Statement, StatementLine } from '@/lib/server/ledger/statements';

export type StatementOfAccountProps = {
  statement: Statement | null;
  /** What "positive balance" means in this context — surfaces as a hint under the KPI. */
  balanceMeaning: string;
  /** Plural label for the empty state ("transactions" / "postings"). */
  noun?: string;
  /** Optional Date range header (renders in the corner if set). */
  rangeLabel?: string;
  /** Optional click handler — used to deep-link into the transaction window. */
  onSelectTransaction?: (txnId: string) => void;
  /**
   * Base filename (no extension) for the PDF / Excel export. When set, an
   * Export control appears once the statement has rows. Omit to hide export.
   */
  exportName?: string;
};

export function StatementOfAccount({
  statement,
  balanceMeaning,
  noun = 'postings',
  rangeLabel,
  onSelectTransaction,
  exportName,
}: StatementOfAccountProps) {
  if (!statement) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading {noun}…</p>;
  }
  const { closingBalancePaise, lines } = statement;

  function handleExport(format: ExportFormat) {
    const headers = [
      'Date',
      'Reference',
      'Kind',
      'Account code',
      'Account',
      'Status',
      'Memo',
      'Debit',
      'Credit',
      'Balance',
    ];
    const data: Record<string, string | number>[] = lines.map((l) => ({
      Date: l.txnDate.slice(0, 10),
      Reference: l.reference,
      Kind: l.kind.replace(/_/g, ' '),
      'Account code': l.accountCode,
      Account: l.accountName,
      Status: l.status,
      Memo: l.description ?? '',
      Debit: l.side === 'debit' ? paiseToRupees(l.amountPaise) : 0,
      Credit: l.side === 'credit' ? paiseToRupees(l.amountPaise) : 0,
      Balance: paiseToRupees(l.runningBalancePaise),
    }));
    exportRows(data, headers, exportName ?? 'ledger', format, 'Ledger');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 16,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            Closing balance
          </div>
          <div
            className="font-display"
            style={{
              fontSize: 26,
              marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
              color:
                closingBalancePaise === 0n
                  ? 'var(--text)'
                  : closingBalancePaise > 0n
                    ? 'var(--apar-red, #c33)'
                    : 'var(--apar-green, #2E8F5A)',
            }}
          >
            {formatINR(closingBalancePaise)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {balanceMeaning}
          </div>
        </div>
        {rangeLabel || (exportName && lines.length > 0) ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 6,
            }}
          >
            {rangeLabel ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rangeLabel}</div>
            ) : null}
            {exportName && lines.length > 0 ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => handleExport('pdf')}
                  title="Download these ledger entries as a PDF file"
                >
                  Export PDF
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => handleExport('xlsx')}
                  title="Download these ledger entries as an Excel (.xlsx) file"
                >
                  Export Excel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {lines.length === 0 ? (
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            margin: 0,
            padding: 16,
            border: '1px dashed var(--border)',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          No {noun} in this range yet. Once invoices, payments, or bills post, they appear here in
          chronological order with a running balance.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reference</th>
              <th>Account</th>
              <th style={{ textAlign: 'right' }}>Debit</th>
              <th style={{ textAlign: 'right' }}>Credit</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <StatementRow
                key={line.postingId}
                line={line}
                onSelectTransaction={onSelectTransaction}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatementRow({
  line,
  onSelectTransaction,
}: {
  line: StatementLine;
  onSelectTransaction?: (txnId: string) => void;
}) {
  const debit = line.side === 'debit' ? line.amountPaise : 0n;
  const credit = line.side === 'credit' ? line.amountPaise : 0n;
  const clickable = !!onSelectTransaction;
  const dateLabel = new Date(line.txnDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
  const isDraft = line.status === 'draft';
  return (
    <tr
      style={{
        cursor: clickable ? 'pointer' : undefined,
        // Visually muted for drafts so the user can tell at a glance
        // which lines haven't been posted yet.
        opacity: isDraft ? 0.7 : 1,
      }}
      onClick={clickable ? () => onSelectTransaction!(line.txnId) : undefined}
    >
      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dateLabel}</td>
      <td>
        <div
          style={{
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
            fontSize: 11.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {line.reference}
          {isDraft ? (
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                color: 'var(--apar-amber, #d08a1e)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              draft
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {line.kind.replace(/_/g, ' ')}
        </div>
      </td>
      <td>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{line.accountName}</div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-jetbrains-mono, monospace)',
          }}
        >
          {line.accountCode}
        </div>
      </td>
      <td
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: debit > 0n ? 'var(--text)' : 'var(--text-dim)',
        }}
      >
        {debit > 0n ? formatINR(debit) : '—'}
      </td>
      <td
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: credit > 0n ? 'var(--text)' : 'var(--text-dim)',
        }}
      >
        {credit > 0n ? formatINR(credit) : '—'}
      </td>
      <td
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          color:
            line.runningBalancePaise === 0n
              ? 'var(--text)'
              : line.runningBalancePaise > 0n
                ? 'var(--apar-red, #c33)'
                : 'var(--apar-green, #2E8F5A)',
        }}
      >
        {formatINR(line.runningBalancePaise)}
      </td>
    </tr>
  );
}
