'use client';

// Generic account-statement window — the drill-down behind every number on
// the Accounts Overview. Shows each posting on the given GL account codes
// (date, document number, counterparty, particulars, debit/credit, running
// total); clicking a row opens the full double-entry transaction with its
// source document (invoice / bill / voucher). Same StatementOfAccount
// renderer as the client/vendor/office ledgers, so exports work too.

import { useEffect, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { getAccountStatement, type Statement } from '@/lib/server/ledger/statements';
import { osActions } from '@/lib/os/store';

export type AccountStatementWindowProps = {
  codes: readonly string[];
  positive: 'debit' | 'credit';
  title: string;
  initialFrom?: string;
  initialTo?: string;
};

export function AccountStatementWindow({
  codes,
  positive,
  title,
  initialFrom,
  initialTo,
}: AccountStatementWindowProps) {
  const [fromDate, setFromDate] = useState<string>(initialFrom ?? '');
  const [toDate, setToDate] = useState<string>(initialTo ?? '');
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    getAccountStatement({
      codes,
      positive,
      from: fromDate || undefined,
      to: toDate || undefined,
    })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the statement');
      });
    return () => {
      cancelled = true;
    };
    // codes is stable for a window instance (parsed from the route).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes.join('+'), positive, fromDate, toDate]);

  return (
    <div
      className="main"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 18, gap: 14 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          paddingBottom: 10,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Account{codes.length === 1 ? '' : 's'} {codes.join(', ')} — every posting in date
            order. Click a row to open the full transaction and its document.
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
      </header>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="postings"
          balanceMeaning={
            positive === 'debit'
              ? 'Running total — debits add, credits subtract'
              : 'Running total — credits add, debits subtract'
          }
          rangeLabel={
            fromDate || toDate ? `${fromDate || 'start'} → ${toDate || 'today'}` : 'all time'
          }
          exportName={`account-${codes.join('-')}`}
          onSelectTransaction={(txnId) =>
            osActions.openWindow({
              app: 'transactions',
              entityId: txnId,
              title: 'Transaction',
              position: 'beside-focused',
            })
          }
        />
      )}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 12,
          color: 'var(--text)',
        }}
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Route encoding                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The ledger app reaches this window via an entityId sub-route:
 *   account:<codes joined by +>:<debit|credit>:<from>:<to>:<uri-encoded title>
 * (from/to may be empty). Kept in one place so the overview and os-root
 * can't drift apart.
 */
export function encodeAccountStatementRoute(opts: {
  codes: readonly string[];
  positive: 'debit' | 'credit';
  title: string;
  from?: string;
  to?: string;
}): string {
  return [
    'account',
    opts.codes.join('+'),
    opts.positive,
    opts.from ?? '',
    opts.to ?? '',
    encodeURIComponent(opts.title),
  ].join(':');
}

export function parseAccountStatementRoute(eid: string): AccountStatementWindowProps | null {
  if (!eid.startsWith('account:')) return null;
  const [, codesPart, positive, from, to, ...titleParts] = eid.split(':');
  if (!codesPart || (positive !== 'debit' && positive !== 'credit')) return null;
  const codes = codesPart.split('+').filter(Boolean);
  if (codes.length === 0) return null;
  return {
    codes,
    positive,
    title: decodeURIComponent(titleParts.join(':') || 'Account statement'),
    initialFrom: from || undefined,
    initialTo: to || undefined,
  };
}
