'use client';

// Universal Ledger — every posted transaction across the company (clients,
// vendors, office, salaries) in one paged statement. One row per transaction
// with counterparty, doc number and total; rows click through to the
// transaction window. Server-paged so the whole history stays browsable.

import { Fragment, useEffect, useState } from 'react';

import { formatINR } from '@/components/shared/format-inr';
import { paiseToRupees } from '@/lib/client/export-rows';
import {
  getUniversalLedger,
  type UniversalLedgerPage,
  type UniversalLedgerRow,
} from '@/lib/server/ledger/report-suite';
import { openTransactionOrInvoice } from './open-invoice';
import {
  DateField,
  OsExportButtons,
  ReportWindowFrame,
  currentFyDefaults,
  exportRows,
  useReportData,
  type ExportFormat,
} from './report-window-kit';

const PAGE_SIZE = 100;

// All transaction kinds (schema/transactions.ts transactionKindEnum), offered
// as exact-match filters. Kept as a literal list — importing the drizzle
// schema into a client bundle just for the enum values isn't worth it.
const TXN_KINDS = [
  'client_invoice',
  'client_payment_received',
  'client_advance_received',
  'vendor_bill',
  'vendor_payment_made',
  'expense_on_behalf',
  'employee_reimbursement',
  'office_expense',
  'inter_bank_transfer',
  'partner_capital',
  'partner_drawing',
  'journal',
  'salary_disbursement',
  'bonus_payment',
] as const;

const controlLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const controlInputStyle: React.CSSProperties = {
  background: 'var(--content-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text)',
};

/** The "(Being … )"-style narration under each journal entry. */
function narration(r: UniversalLedgerRow): string {
  const parts = [r.kind.replace(/_/g, ' ')];
  if (r.counterpartyName) parts.push(r.counterpartyName);
  if (r.description) parts.push(r.description);
  if (r.bankAccountLabel) parts.push(r.bankAccountLabel);
  return parts.join(' · ');
}

export function UniversalLedgerWindow() {
  const fy = currentFyDefaults();
  const [fromDate, setFromDate] = useState(fy.fromDate);
  const [toDate, setToDate] = useState(fy.toDate);
  const [kind, setKind] = useState('all');
  const [partySearch, setPartySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);

  // Debounce the party search ~300ms so we don't hit the server per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(partySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [partySearch]);

  const { data, error } = useReportData<UniversalLedgerPage>(
    () =>
      getUniversalLedger({
        from: fromDate,
        to: toDate,
        kind: kind === 'all' ? undefined : kind,
        partySearch: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [fromDate, toDate, kind, debouncedSearch, page],
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;

  function handleExport(format: ExportFormat) {
    if (!data) return;
    // One row per posting leg, in journal form — debits then credits — so the
    // exported sheet reconciles column by column (Σ Debit = Σ Credit).
    const headers = ['Date', 'Particulars', 'Voucher', 'Debit', 'Credit'];
    const rows: Record<string, string | number>[] = [];
    for (const r of data.rows) {
      const legs = [...r.legs].sort((a, b) =>
        a.side === b.side ? 0 : a.side === 'debit' ? -1 : 1,
      );
      legs.forEach((leg, i) => {
        rows.push({
          Date: i === 0 ? r.txnDate.slice(0, 10) : '',
          Particulars:
            leg.side === 'debit'
              ? `${leg.accountName} A/c (${leg.accountCode})`
              : `    To ${leg.accountName} A/c (${leg.accountCode})`,
          Voucher: i === 0 ? (r.documentNumber ?? r.externalRef) : '',
          Debit: leg.side === 'debit' ? paiseToRupees(leg.amountPaise) : '',
          Credit: leg.side === 'credit' ? paiseToRupees(leg.amountPaise) : '',
        });
      });
      // Narration line for the entry.
      rows.push({
        Date: '',
        Particulars: `  (${narration(r)})`,
        Voucher: '',
        Debit: '',
        Credit: '',
      });
    }
    exportRows(
      rows,
      headers,
      `universal-ledger-${fromDate}-to-${toDate}-page-${page + 1}`,
      format,
      'Universal Ledger',
    );
  }

  return (
    <ReportWindowFrame
      title="Universal Ledger"
      subtitle="Every transaction across the company in double-entry journal form — each entry shows its debits and credits (Dr = Cr)."
      error={error}
      loading={!data}
      isEmpty={!!data && data.rows.length === 0}
      emptyText="No transactions match these filters."
      controls={
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <DateField
            label="From"
            value={fromDate}
            onChange={(v) => {
              setFromDate(v);
              setPage(0);
            }}
          />
          <DateField
            label="To"
            value={toDate}
            onChange={(v) => {
              setToDate(v);
              setPage(0);
            }}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={controlLabelStyle}>Kind</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(0);
              }}
              style={controlInputStyle}
            >
              <option value="all">All kinds</option>
              {TXN_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={controlLabelStyle}>Party</span>
            <input
              type="text"
              placeholder="Client, vendor, employee…"
              value={partySearch}
              onChange={(e) => {
                setPartySearch(e.target.value);
                setPage(0);
              }}
              style={{ ...controlInputStyle, width: 160 }}
            />
          </label>
          <span title="Exports the current page only (up to 100 rows) — page through for the rest.">
            <OsExportButtons onExport={handleExport} disabled={!data || data.rows.length === 0} />
          </span>
        </div>
      }
    >
      {data ? (
        <>
          <table className="table" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: 'nowrap' }}>Date</th>
                <th>Particulars</th>
                <th>Voucher</th>
                <th style={{ textAlign: 'right' }}>Debit</th>
                <th style={{ textAlign: 'right' }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const legs = [...r.legs].sort((a, b) =>
                  a.side === b.side ? 0 : a.side === 'debit' ? -1 : 1,
                );
                // Invoice entries open the invoice PDF itself; everything
                // else opens the plain transaction window.
                const open = () =>
                  openTransactionOrInvoice(r.txnId, r.kind, r.documentNumber ?? undefined);
                return (
                  <Fragment key={r.txnId}>
                    {legs.map((leg, i) => (
                      <tr
                        key={`${r.txnId}-${i}`}
                        style={{
                          cursor: 'pointer',
                          borderTop: i === 0 ? '2px solid var(--border)' : undefined,
                        }}
                        onClick={open}
                      >
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {i === 0
                            ? new Date(r.txnDate).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: '2-digit',
                              })
                            : ''}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          <span style={{ paddingLeft: leg.side === 'credit' ? 22 : 0 }}>
                            {leg.side === 'credit' ? 'To ' : ''}
                            {leg.accountName} A/c
                          </span>
                          <span
                            style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--text-muted)' }}
                          >
                            {leg.accountCode}
                          </span>
                        </td>
                        <td style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                          {i === 0 ? (r.documentNumber ?? r.externalRef) : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {leg.side === 'debit' ? formatINR(leg.amountPaise) : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {leg.side === 'credit' ? formatINR(leg.amountPaise) : ''}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ cursor: 'pointer' }} onClick={open}>
                      <td />
                      <td
                        colSpan={4}
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontStyle: 'italic',
                          paddingBottom: 8,
                        }}
                      >
                        ({narration(r)})
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginTop: 10,
              paddingTop: 10,
              borderTop: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Debit = Credit = {formatINR(data.totalAmountPaise)} · {data.totalCount} entr
              {data.totalCount === 1 ? 'y' : 'ies'}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="btn"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </ReportWindowFrame>
  );
}
