'use client';

// Salaries to be Paid OS window (§1.2a/1.2b). Lists every active employee with
// their attendance-prorated salary due for a chosen month (previewSalaryFromAttendance),
// with a per-row "Record" button and a multi-select "Record selected" bulk bar
// that posts each to the ledger (Dr 6100 / Cr 1110-or-1120) via
// recordSalaryPaymentsBulk. Opened from the Office app and routed under the
// 'ledger' app (entityId 'salaries-to-be-paid').

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DateField as SharedDateField } from '@/components/shared/date-field';
import { formatINR } from '@/lib/money';
import { useCurrentUser } from '@/lib/client/use-current-user';
import {
  previewSalaryFromAttendance,
  type SalaryAttendancePreview,
} from '@/lib/server/entities/salary-attendance';
import { recordSalaryPaymentsBulk } from '@/lib/server/entities/payroll';
import { listAgencyBankAccounts } from '@/lib/server/billing/agency-banks';
import { osActions } from '@/lib/os/store';

type BankOption = {
  id: string;
  label: string;
  bankName: string | null;
  accountLast4: string | null;
  isActive: boolean;
};

/** Previous calendar month as YYYY-MM — salaries are usually run for the month just gone. */
function previousMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 'YYYY-MM' → 'March 2026'. */
function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function SalariesToBePaidWindow() {
  const { hasCapability } = useCurrentUser();
  // previewSalaryFromAttendance requires both caps; recording needs the payroll
  // + posting caps. A custom role may have one but not the other.
  const canView = hasCapability('create_salary_run') && hasCapability('view_salary');
  const canRecord = hasCapability('manage_salary_structures') && hasCapability('post_transaction');

  const [month, setMonth] = useState<string>(() => previousMonthISO());
  const [preview, setPreview] = useState<SalaryAttendancePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banks, setBanks] = useState<BankOption[]>([]);

  // Shared record controls.
  const [paidOn, setPaidOn] = useState<string>(() => todayISO());
  const [mode, setMode] = useState<'cash' | 'bank'>('cash');
  const [bankAccountId, setBankAccountId] = useState<string>('');

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Employees recorded during THIS window session — greyed out so a second
  // click can't double-post. (The preview always recomputes the same dues; it
  // has no notion of "already paid", so this guards within the session.)
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setPreview(null);
      setError(null);
      setSelected(new Set());
      setRecorded(new Set());
    });
    previewSalaryFromAttendance(month)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load salaries');
      });
    return () => {
      cancelled = true;
    };
  }, [month, canView]);

  useEffect(() => {
    if (!canRecord) return;
    let cancelled = false;
    listAgencyBankAccounts()
      .then((rows) => {
        if (cancelled) return;
        setBanks(rows.map((r) => ({ ...r })));
        // Default the bank picker to the first active account.
        const firstActive = rows.find((r) => r.isActive) ?? rows[0];
        if (firstActive) setBankAccountId((prev) => prev || firstActive.id);
      })
      .catch(() => {
        /* non-fatal — cash still works without a bank list */
      });
    return () => {
      cancelled = true;
    };
  }, [canRecord]);

  // A line is payable when it has a salary structure and a positive due, and
  // hasn't already been recorded this session. Cheap derived values — computed
  // inline (the React Compiler memoizes) rather than manual useMemo.
  const isPayable = (empId: string, hasStructure: boolean, due: bigint) =>
    hasStructure && due > 0n && !recorded.has(empId);

  const payableIds = preview
    ? preview.lines
        .filter((l) => isPayable(l.employeeId, l.hasStructure, l.proratedGrossPaise))
        .map((l) => l.employeeId)
    : [];

  const totalDue = preview
    ? preview.lines.reduce((sum, l) => sum + l.proratedGrossPaise, 0n)
    : 0n;

  const selectedTotal = preview
    ? preview.lines
        .filter((l) => selected.has(l.employeeId))
        .reduce((sum, l) => sum + l.proratedGrossPaise, 0n)
    : 0n;

  const allPayableSelected = payableIds.length > 0 && payableIds.every((id) => selected.has(id));

  function toggleRow(empId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId);
      else next.add(empId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() => (allPayableSelected ? new Set() : new Set(payableIds)));
  }

  async function recordLines(employeeIds: readonly string[]) {
    if (!preview || employeeIds.length === 0 || busy) return;
    if (!paidOn) {
      toast.error('Pick the date the salaries were paid.');
      return;
    }
    if (mode === 'bank' && !bankAccountId) {
      toast.error('Pick the bank account the salaries were paid from.');
      return;
    }
    const byId = new Map(preview.lines.map((l) => [l.employeeId, l]));
    const lines = employeeIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l && l.hasStructure && l.proratedGrossPaise > 0n)
      .map((l) => ({
        employeeId: l.employeeId,
        amountPaise: l.proratedGrossPaise,
        expectedAmountPaise: l.proratedGrossPaise,
        notes: `Salary for ${formatMonthLabel(month)}`,
      }));
    if (lines.length === 0) {
      toast.error('Nothing payable in the selection.');
      return;
    }
    setBusy(true);
    try {
      const res = await recordSalaryPaymentsBulk({
        paidOn,
        mode,
        bankAccountId: mode === 'bank' ? bankAccountId : null,
        lines,
      });
      const okIds = res.results.filter((r) => r.ok).map((r) => r.employeeId);
      if (okIds.length > 0) {
        setRecorded((prev) => {
          const next = new Set(prev);
          for (const id of okIds) next.add(id);
          return next;
        });
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of okIds) next.delete(id);
          return next;
        });
      }
      const failed = res.results.filter((r) => !r.ok);
      if (res.postedCount > 0 && failed.length === 0) {
        toast.success(
          `Recorded ${res.postedCount} salar${res.postedCount === 1 ? 'y' : 'ies'} · ${formatINR(
            BigInt(res.totalPaise),
          )}`,
        );
      } else if (res.postedCount > 0) {
        toast.warning(
          `Recorded ${res.postedCount}; ${failed.length} failed (${failed[0]?.error ?? ''}).`,
        );
      } else {
        toast.error(`Could not record: ${failed[0]?.error ?? 'unknown error'}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record salaries');
    } finally {
      setBusy(false);
    }
  }

  if (!canView) {
    return (
      <div className="main" style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
        You don&apos;t have permission to view salaries to be paid. This needs the payroll-run and
        view-salary permissions.
      </div>
    );
  }

  const activeBanks = banks.filter((b) => b.isActive || b.id === bankAccountId);

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
            Salaries to be paid
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Attendance-prorated dues for {formatMonthLabel(month)} — salary ÷ days in month, only
            absences cut pay. Recording posts Dr 6100 / Cr {mode === 'cash' ? '1110' : '1120'}.
          </div>
        </div>
        <MonthField value={month} onChange={setMonth} />
        <button
          type="button"
          className="btn"
          onClick={() =>
            osActions.openWindow({
              app: 'ledger',
              entityId: 'salary-book',
              title: 'Salary book',
              position: 'beside-focused',
            })
          }
          title="Open the per-employee salary book to see what's already been paid"
        >
          Salary book →
        </button>
      </header>

      {/* Record controls */}
      {canRecord ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: 10,
            background: 'var(--content-2)',
          }}
        >
          <Field label="Paid on">
            <SharedDateField
              value={paidOn}
              onChange={(v) => setPaidOn(v)}
              clearable={false}
              className="w-[150px]"
            />
          </Field>
          <Field label="Mode">
            <div
              role="tablist"
              aria-label="Payment mode"
              style={{
                display: 'inline-flex',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {(['cash', 'bank'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className="btn"
                  style={{
                    border: 'none',
                    borderRadius: 0,
                    fontSize: 12,
                    textTransform: 'capitalize',
                    background: mode === m ? 'var(--apar-red, #E63A1F)' : 'transparent',
                    color: mode === m ? '#fff' : 'inherit',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          {mode === 'bank' ? (
            <Field label="Bank account">
              <select
                className="input"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="">Select…</option>
                {activeBanks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                    {b.accountLast4 ? ` ••${b.accountLast4}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn primary"
            disabled={busy || selected.size === 0}
            onClick={() => recordLines([...selected])}
            title="Record every selected salary in one go"
            style={{
              background: selected.size > 0 ? 'var(--apar-red, #E63A1F)' : undefined,
              color: selected.size > 0 ? '#fff' : undefined,
            }}
          >
            {busy
              ? 'Recording…'
              : `Record selected (${selected.size})${selected.size > 0 ? ` · ${formatINR(selectedTotal)}` : ''}`}
          </button>
        </div>
      ) : null}

      {/* Total due */}
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
          Total salary due
        </span>
        <span className="font-display" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
          {preview ? formatINR(totalDue) : '—'}
        </span>
        {preview ? (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {preview.lines.length} employee{preview.lines.length === 1 ? '' : 's'} ·{' '}
            {payableIds.length} payable
          </span>
        ) : null}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {error ? (
          <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</p>
        ) : preview === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
        ) : preview.lines.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No active employees.</p>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ ...th, width: 28 }}>
                  {canRecord ? (
                    <input
                      type="checkbox"
                      aria-label="Select all payable"
                      checked={allPayableSelected}
                      onChange={toggleAll}
                      disabled={payableIds.length === 0}
                    />
                  ) : null}
                </th>
                <th style={th}>Employee</th>
                <th style={{ ...th, textAlign: 'right' }}>Monthly gross</th>
                <th style={{ ...th, textAlign: 'right' }}>Payable days</th>
                <th style={{ ...th, textAlign: 'right' }}>LOP</th>
                <th style={{ ...th, textAlign: 'right' }}>Salary due</th>
                <th style={{ ...th, width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((l) => {
                const done = recorded.has(l.employeeId);
                const payable = isPayable(l.employeeId, l.hasStructure, l.proratedGrossPaise);
                return (
                  <tr
                    key={l.employeeId}
                    style={{
                      opacity: done ? 0.5 : 1,
                      background: selected.has(l.employeeId) ? 'var(--content-2)' : undefined,
                    }}
                  >
                    <td style={{ ...td, textAlign: 'center' }}>
                      {canRecord ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${l.fullName}`}
                          checked={selected.has(l.employeeId)}
                          onChange={() => toggleRow(l.employeeId)}
                          disabled={!payable}
                        />
                      ) : null}
                    </td>
                    <td style={td}>
                      <button
                        type="button"
                        className="linklike"
                        onClick={() =>
                          osActions.openWindow({
                            app: 'employees',
                            entityId: l.employeeId,
                            tab: 'compensation',
                            position: 'beside-focused',
                          })
                        }
                        title={`Open ${l.fullName}'s compensation`}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'var(--text)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {l.fullName}
                      </button>
                      {!l.hasStructure ? (
                        <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 11 }}>
                          no salary structure
                        </span>
                      ) : null}
                      {done ? (
                        <span
                          style={{
                            marginLeft: 8,
                            color: 'var(--apar-green, #2E8F5A)',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          Recorded
                        </span>
                      ) : null}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>
                      {l.hasStructure ? formatINR(l.monthlyGrossPaise) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>
                      {l.payableDays}/{l.daysInMonth}
                    </td>
                    <td
                      style={{
                        ...td,
                        textAlign: 'right',
                        color: l.lopDays > 0 ? 'var(--apar-red, #c33)' : 'var(--text-muted)',
                      }}
                    >
                      {l.lopDays}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                      {l.hasStructure ? formatINR(l.proratedGrossPaise) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {canRecord ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !payable}
                          onClick={() => recordLines([l.employeeId])}
                          title={
                            payable
                              ? `Record ${l.fullName}'s salary`
                              : done
                                ? 'Already recorded this session'
                                : 'No salary structure / nothing due'
                          }
                          style={{ fontSize: 12, padding: '3px 10px' }}
                        >
                          {done ? 'Recorded' : 'Record'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
      {children}
    </label>
  );
}

function MonthField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Month">
      <input
        type="month"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 150 }}
      />
    </Field>
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
