'use client';

// Office Ledger OS window — LEDGER-SPEC §5.2 cash-flow surface.
//
// Shows every posting on the cash + bank accounts (1110 + 1120) in
// chronological order, with a running balance equal to our cash position.
// This is what an accountant calls a "bank book" / "cash book". Salary
// payments post Dr 6100 / Cr 1110, so they already flow through this balance —
// the panel below just breaks down how much salary was paid to each employee
// in the range (it does NOT re-deduct, which would double-count).

import { useEffect, useMemo, useState } from 'react';

import { StatementOfAccount } from '@/components/entity/statement-of-account';
import { DateField as SharedDateField } from '@/components/shared/date-field';
import { getOfficeStatement, type Statement } from '@/lib/server/ledger/statements';
import { getSalaryBook, type SalaryBook } from '@/lib/server/entities/payroll';
import { formatINR } from '@/lib/money';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

export function OfficeLedgerWindow({
  title = 'Office ledger',
  subtitle = 'Cash + bank movements (accounts 1110 + 1120). Running balance is our cash position; salary payouts (Dr 6100 / Cr 1110) are included. Office utilities (6200) land in the next phase.',
  exportPrefix = 'office-ledger',
}: {
  /** Window header title. Defaults to "Office ledger"; the Bank Book report
   *  route reuses this component with title "Bank Book". */
  title?: string;
  subtitle?: string;
  /** Base for the export filename (date range is appended). */
  exportPrefix?: string;
} = {}) {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [salaryBook, setSalaryBook] = useState<SalaryBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatement(null);
      setSalaryBook(null);
      setError(null);
    });
    // Salary postings already credit cash (1110), so the office balance
    // includes them — we don't subtract again, just show a per-employee
    // breakdown of what was paid out in this range.
    Promise.all([
      getOfficeStatement({ from: fromDate, to: toDate }),
      getSalaryBook({ from: fromDate, to: toDate }),
    ])
      .then(([s, book]) => {
        if (cancelled) return;
        setStatement(s);
        setSalaryBook(book);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load office ledger');
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
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
      </header>

      {!error && salaryBook && salaryBook.rows.length > 0 ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--content-2)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              Salaries paid · by employee (this range)
            </span>
            <span
              className="font-display"
              style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatINR(salaryBook.totalPaise)}
            </span>
          </div>
          <div style={{ maxHeight: 150, overflow: 'auto' }}>
            {salaryBook.rows.map((r) => (
              <button
                key={r.employeeId}
                type="button"
                onClick={() =>
                  osActions.openWindow({
                    app: 'employees',
                    entityId: r.employeeId,
                    tab: 'compensation',
                    position: 'beside-focused',
                  })
                }
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '6px 14px',
                  fontSize: 12.5,
                  borderTop: '1px solid var(--border)',
                  background: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                title={`Open ${r.employeeName}'s compensation`}
              >
                <span>
                  {r.employeeName}
                  <span style={{ color: 'var(--text-muted)' }}> · {r.employeeCode}</span>
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {r.count} pmt{r.count === 1 ? '' : 's'}
                </span>
                <span className="font-display" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatINR(r.totalPaise)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
      ) : (
        <StatementOfAccount
          statement={statement}
          noun="cash movements"
          balanceMeaning="Positive = cash on hand + bank balance"
          rangeLabel={`${fromDate} → ${toDate}`}
          exportName={`${exportPrefix}-${fromDate}_to_${toDate}`}
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
      <SharedDateField value={value} onChange={onChange} clearable={false} className="w-[150px]" />
    </label>
  );
}
