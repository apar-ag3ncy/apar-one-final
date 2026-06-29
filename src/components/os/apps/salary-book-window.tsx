'use client';

// Salary Book OS window — a per-employee ledger of salary paid out. Reads the
// posted salary_disbursement transactions (via getSalaryBook), one row per
// employee with their cumulative total in the selected range. Opened from the
// Office app and routed under the 'ledger' app (entityId 'salary-book').

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { getSalaryBook, type SalaryBook } from '@/lib/server/entities/payroll';
import { formatINR } from '@/lib/money';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import { osActions } from '@/lib/os/store';

function currentFyDefaults(): { fromDate: string; toDate: string } {
  const today = new Date();
  const fy = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    fromDate: `${fy}-04-01`,
    toDate: today.toISOString().slice(0, 10),
  };
}

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function SalaryBookWindow() {
  const defaults = useMemo(() => currentFyDefaults(), []);
  const [fromDate, setFromDate] = useState<string>(defaults.fromDate);
  const [toDate, setToDate] = useState<string>(defaults.toDate);
  const [book, setBook] = useState<SalaryBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBook(null);
      setError(null);
    });
    getSalaryBook({ from: fromDate, to: toDate })
      .then((b) => {
        if (!cancelled) setBook(b);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load salary book');
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  function handleExport(format: ExportFormat) {
    if (!book || book.rows.length === 0) {
      toast.error('Nothing to export in this range.');
      return;
    }
    const headers = ['Employee', 'Code', 'Payments', 'Last paid', 'Total'];
    const rows = book.rows.map((r) => ({
      Employee: r.employeeName,
      Code: r.employeeCode,
      Payments: r.count,
      'Last paid': r.lastPaidOn ?? '',
      Total: paiseToRupees(r.totalPaise),
    }));
    exportRows(rows, headers, `salary-book-${fromDate}_to_${toDate}`, format, 'Salary book');
  }

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 17 }}>
            Salary book
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            How much salary each employee has been paid (posted to the ledger, Dr 6100 / Cr 1110).
          </div>
        </div>
        <DateField label="From" value={fromDate} onChange={setFromDate} />
        <DateField label="To" value={toDate} onChange={setToDate} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={() => handleExport('pdf')}
            disabled={!book || book.rows.length === 0}
          >
            Export PDF
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => handleExport('xlsx')}
            disabled={!book || book.rows.length === 0}
          >
            Export Excel
          </button>
        </div>
      </header>

      {/* Grand total */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          padding: '10px 14px',
          border: '1px solid var(--border)',
          borderRadius: 10,
          background: 'var(--content-2)',
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
          Total salaries paid
        </span>
        <span className="font-display" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
          {book ? formatINR(book.totalPaise) : '—'}
        </span>
        {book ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            across {book.rows.length} employee{book.rows.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? (
          <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
        ) : book === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
        ) : book.rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No salary paid in this range. Record payments from an employee&apos;s Compensation tab.
          </p>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={th}>Employee</th>
                <th style={th}>Code</th>
                <th style={{ ...th, textAlign: 'right' }}>Payments</th>
                <th style={th}>Last paid</th>
                <th style={{ ...th, textAlign: 'right' }}>Total paid</th>
              </tr>
            </thead>
            <tbody>
              {book.rows.map((r) => (
                <tr
                  key={r.employeeId}
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    osActions.openWindow({
                      app: 'employees',
                      entityId: r.employeeId,
                      tab: 'compensation',
                      position: 'beside-focused',
                    })
                  }
                  title={`Open ${r.employeeName}'s compensation`}
                >
                  <td style={td}>{r.employeeName}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{r.employeeCode}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.count}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{formatDay(r.lastPaidOn)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {formatINR(r.totalPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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

const th: React.CSSProperties = {
  padding: '6px 8px',
  fontWeight: 600,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
};

const td: React.CSSProperties = {
  padding: '7px 8px',
  borderBottom: '1px solid var(--border)',
  fontVariantNumeric: 'tabular-nums',
};
