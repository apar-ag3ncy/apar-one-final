'use client';

// TDS book OS window. Two ledgers on the tax-deducted-at-source accounts:
//   - Receivable (1260): TDS clients withheld from their payments to us — an
//     asset we reclaim against our income-tax liability.
//   - Payable (2130): TDS we withheld from vendor bills/payments — a liability
//     we owe the tax department until remitted.
// Both are plain account books (running balance over a date range), reusing the
// shared StatementOfAccount view.

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import {
  getTdsPayableStatement,
  getTdsReceivableStatement,
  type Statement,
} from '@/lib/server/ledger/statements';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { fromDate: `${fy}-04-01`, toDate: today.toISOString().slice(0, 10) };
}

type Side = 'receivable' | 'payable';

export function TdsBookWindow() {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [side, setSide] = useState<Side>('receivable');
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setError(null);
    });
    const load = side === 'receivable' ? getTdsReceivableStatement : getTdsPayableStatement;
    load({ from: fromDate, to: toDate })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the TDS book');
      });
    return () => {
      cancelled = true;
    };
  }, [side, fromDate, toDate]);

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
        }}
      >
        <div style={{ flex: 1 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            TDS book
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Tax deducted at source, kept separate from the party ledgers. Receivable = withheld by
            clients (1260); Payable = withheld from vendors, owed to the tax dept (2130).
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
      </header>

      <div style={{ display: 'flex', gap: 6 }}>
        <ToggleButton active={side === 'receivable'} onClick={() => setSide('receivable')}>
          Receivable · withheld by clients (1260)
        </ToggleButton>
        <ToggleButton active={side === 'payable'} onClick={() => setSide('payable')}>
          Payable · withheld from vendors (2130)
        </ToggleButton>
      </div>

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="TDS entries"
          balanceMeaning={
            side === 'receivable'
              ? 'TDS withheld by clients — an asset we reclaim from the tax dept (1260)'
              : 'TDS withheld from vendors — a liability we owe the tax dept (2130)'
          }
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`tds-${side}-${fromDate}_to_${toDate}`}
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

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12.5,
        borderRadius: 7,
        border: '1px solid var(--border)',
        background: active ? 'var(--accent, #4a72ff)' : 'var(--content-2)',
        color: active ? '#fff' : 'var(--text)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
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
