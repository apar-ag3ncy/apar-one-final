'use client';

// Office Utilities Ledger OS window.
//
// Every expense recorded in the Office app over the selected date range,
// with a running total of spend. This is the single book of all office
// expenses — each Office-app entry auto-posts an OFFEXP- journal and its
// OpEx leg shows here, whatever the category. Mirrors the Office Ledger
// (cash/bank) window's shape — same StatementOfAccount renderer, a
// different server-side filter (getOfficeUtilitiesStatement).

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { getOfficeUtilitiesStatement, type Statement } from '@/lib/server/ledger/statements';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function OfficeUtilitiesWindow() {
  const defaults = useMemo(() => currentFyDefaults(), []);
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
    getOfficeUtilitiesStatement({ from: fromDate, to: toDate })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load office utilities ledger');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

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
            Office utilities ledger
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every expense recorded in the Office app — rent, utilities, stationery, travel,
            repairs and every other category, each one landing here as it&apos;s logged. Closing
            balance = total office spend in the window.
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
          noun="office expenses"
          balanceMeaning="Total office spend in this range"
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`office-utilities-${fromDate}_to_${toDate}`}
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
