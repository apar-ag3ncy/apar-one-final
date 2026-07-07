'use client';

// Compensation section for the OS Employee window. Renders:
//   - Current salary structure (basic, HRA, allowances, employer contributions, CTC)
//   - Salary version history (effective_from / effective_to chain)
//   - Bonuses & perks list (bonus, perk_cash, perk_inkind, gift, award)
//   - Inline forms to add a new salary version and to record bonuses/perks
//
// All money is captured (CLAUDE rule #2) — no rate × base math here.
// Reads gated by `view_salary`, writes by `manage_salary_structures`
// (salary) and `record_bonus_or_perk` (incentives/perks).

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  createSalaryStructure,
  deleteBonusOrPerk,
  deleteSalaryPayment,
  deleteSalaryStructure,
  listEmployeeBonuses,
  listEmployeeSalaryPayments,
  listEmployeeSalaryStructures,
  recordBonusOrPerk,
  recordSalaryPayment,
  type BonusRow,
  type SalaryPaymentRow,
  type SalaryStructureRow,
} from '@/lib/server/entities/payroll';
import { previewSalaryForEmployee } from '@/lib/server/entities/salary-attendance';
import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import { formatINR, paiseToRupees, rupeesToPaise, type Paise } from '@/lib/money';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';

export type CompensationSectionProps = {
  employeeId: string;
  employeeName: string;
};

type BonusKind = BonusRow['kind'];

const BONUS_KIND_LABEL: Record<BonusKind, string> = {
  bonus: 'Bonus',
  perk_cash: 'Perk (cash)',
  perk_inkind: 'Perk (in-kind)',
  gift: 'Gift',
  award: 'Award',
};

const BONUS_KIND_TONE: Record<BonusKind, string> = {
  bonus: '#2e8f5a',
  perk_cash: '#3f6fb0',
  perk_inkind: '#7a4eaf',
  gift: '#c98a2e',
  award: '#c34a2c',
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Prior calendar month as `YYYY-MM` from today (local time). July 2026 → '2026-06',
 * January 2026 → '2025-12'. Used to seed the salary-payment amount from the previous
 * month's attendance-prorated pay.
 */
function previousMonthISO(): string {
  const d = new Date();
  const prior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prior.getFullYear()}-${pad2(prior.getMonth() + 1)}`;
}

/** Human month name for a `YYYY-MM` string, e.g. '2026-06' → 'June 2026'. */
function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

export function CompensationSection({ employeeId, employeeName }: CompensationSectionProps) {
  const { hasCapability, isLoading } = useCurrentUser();
  // OS read-only bridge — permissive outside the OS. Salary/bonus/payment
  // changes are all edit-class, so they additionally require the OS edit
  // grant for the employees app. Viewing salary is unchanged (a read op).
  const { canEdit: osCanEdit } = useEntityMutation();
  const canView = hasCapability('view_salary');
  const canManageSalary = osCanEdit && hasCapability('manage_salary_structures');
  const canRecordBonus = osCanEdit && hasCapability('record_bonus_or_perk');

  const [structures, setStructures] = useState<readonly SalaryStructureRow[] | null>(null);
  const [bonuses, setBonuses] = useState<readonly BonusRow[] | null>(null);
  const [payments, setPayments] = useState<readonly SalaryPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddSalary, setShowAddSalary] = useState(false);
  const [showRecordBonus, setShowRecordBonus] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);

  async function reload() {
    try {
      const [s, b, p] = await Promise.all([
        canView ? listEmployeeSalaryStructures(employeeId) : Promise.resolve([]),
        listEmployeeBonuses(employeeId),
        canView ? listEmployeeSalaryPayments(employeeId) : Promise.resolve([]),
      ]);
      setStructures(s);
      setBonuses(b);
      setPayments(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load compensation');
    }
  }

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    Promise.all([
      canView
        ? listEmployeeSalaryStructures(employeeId)
        : Promise.resolve([] as readonly SalaryStructureRow[]),
      listEmployeeBonuses(employeeId),
      canView
        ? listEmployeeSalaryPayments(employeeId)
        : Promise.resolve([] as readonly SalaryPaymentRow[]),
    ])
      .then(([s, b, p]) => {
        if (cancelled) return;
        setStructures(s);
        setBonuses(b);
        setPayments(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load compensation');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, canView, isLoading]);

  const active = useMemo(() => {
    if (!structures || structures.length === 0) return null;
    const today = todayISO();
    return (
      structures.find(
        (s) => s.effectiveFrom <= today && (s.effectiveTo === null || s.effectiveTo >= today),
      ) ?? structures[0]
    );
  }, [structures]);

  if (isLoading || structures === null || bonuses === null || payments === null) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading compensation…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--text-error, #c33)', fontSize: 13 }}>{error}</div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Salary — current */}
      {canView ? (
        <OsCard
          title="Current salary"
          action={
            canManageSalary ? (
              <button type="button" className="btn" onClick={() => setShowAddSalary((v) => !v)}>
                {showAddSalary ? 'Cancel' : '+ New version'}
              </button>
            ) : null
          }
        >
          {active ? (
            <SalaryBreakdown row={active} />
          ) : (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              No salary structure on file for {employeeName} yet.
            </p>
          )}
          {showAddSalary && canManageSalary && (
            <NewSalaryForm
              employeeId={employeeId}
              onCancel={() => setShowAddSalary(false)}
              onCreated={async () => {
                setShowAddSalary(false);
                await reload();
              }}
            />
          )}
        </OsCard>
      ) : (
        <OsCard title="Salary">
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            Salary details are restricted. Ask an accountant or partner.
          </p>
        </OsCard>
      )}

      {/* Salary — history (every version listed so a wrong update is deletable;
          deleting one re-extends the previous version over its span) */}
      {canView && structures.length > 0 ? (
        <OsCard title="Salary history">
          <table className="table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={th}>From</th>
                <th style={th}>To</th>
                <th style={{ ...th, textAlign: 'right' }}>Basic</th>
                <th style={{ ...th, textAlign: 'right' }}>HRA</th>
                <th style={{ ...th, textAlign: 'right' }}>Special</th>
                <th style={{ ...th, textAlign: 'right' }}>Monthly CTC</th>
                {canManageSalary ? <th style={{ ...th, width: 36 }} /> : null}
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{formatDay(s.effectiveFrom)}</td>
                  <td style={td}>{s.effectiveTo ? formatDay(s.effectiveTo) : 'current'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{formatINR(s.basicPaise)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{formatINR(s.hraPaise)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {formatINR(s.specialAllowancePaise)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {formatINR(s.ctcMonthlyPaise)}
                  </td>
                  {canManageSalary ? (
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn"
                        title="Delete this salary update (recoverable from Trash for 30 days)"
                        style={{ padding: '2px 8px' }}
                        onClick={async () => {
                          try {
                            await deleteSalaryStructure({ id: s.id });
                            await reload();
                            toast.success('Salary update moved to Trash.');
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : 'Could not delete the salary update',
                            );
                          }
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </OsCard>
      ) : null}

      {/* Bonuses & perks */}
      <OsCard
        title="Bonuses, perks & incentives"
        action={
          canRecordBonus ? (
            <button type="button" className="btn" onClick={() => setShowRecordBonus((v) => !v)}>
              {showRecordBonus ? 'Cancel' : '+ Record'}
            </button>
          ) : null
        }
      >
        {showRecordBonus && canRecordBonus && (
          <RecordBonusForm
            employeeId={employeeId}
            onCancel={() => setShowRecordBonus(false)}
            onCreated={async () => {
              setShowRecordBonus(false);
              await reload();
            }}
          />
        )}
        {bonuses.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            No bonuses or perks recorded yet.
          </p>
        ) : (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {bonuses.map((b) => (
              <li
                key={b.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: canRecordBonus ? '110px 1fr auto auto' : '110px 1fr auto',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: BONUS_KIND_TONE[b.kind],
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: BONUS_KIND_TONE[b.kind],
                    }}
                  />
                  {BONUS_KIND_LABEL[b.kind]}
                </span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.description}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatDay(b.bonusDate)}
                    {b.taxable !== 'captured' ? ` · ${b.taxable.replace('_', ' ')}` : ''}
                  </div>
                </span>
                <span className="font-display" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {b.amountPaise !== null ? formatINR(b.amountPaise) : 'in-kind'}
                </span>
                {canRecordBonus ? (
                  <button
                    type="button"
                    className="btn"
                    title="Delete this bonus (recoverable from Trash for 30 days)"
                    style={{ padding: '2px 8px' }}
                    onClick={async () => {
                      try {
                        await deleteBonusOrPerk({ id: b.id });
                        await reload();
                        toast.success('Bonus moved to Trash.');
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Could not delete the bonus');
                      }
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </OsCard>

      {/* Salary payments — disbursements actually given out */}
      {canView ? (
        <OsCard
          title="Salary payments"
          action={
            canManageSalary ? (
              <button type="button" className="btn" onClick={() => setShowAddPayment((v) => !v)}>
                {showAddPayment ? 'Cancel' : '+ Record payment'}
              </button>
            ) : null
          }
        >
          {showAddPayment && canManageSalary && (
            <SalaryPaymentForm
              employeeId={employeeId}
              prefillPaise={active?.ctcMonthlyPaise ?? null}
              onCancel={() => setShowAddPayment(false)}
              onCreated={async () => {
                setShowAddPayment(false);
                await reload();
              }}
            />
          )}
          {payments.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              No salary payments recorded for {employeeName} yet.
            </p>
          ) : (
            <>
              <ul
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                }}
              >
                {payments.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '110px 1fr auto auto',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {formatDay(p.paidOn)}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.notes ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                        {p.paymentMethod === 'bank' ? (p.bankLabel ?? 'Bank transfer') : 'Cash'}
                      </span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span
                        className="font-display"
                        style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatINR(p.amountPaise)}
                      </span>
                      {p.expectedAmountPaise !== null ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11,
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              p.expectedAmountPaise === p.amountPaise
                                ? 'var(--text-muted)'
                                : 'var(--apar-red, #c34a2c)',
                          }}
                          title="Attendance-prorated salary due when this payment was recorded"
                        >
                          due {formatINR(p.expectedAmountPaise)}
                        </span>
                      ) : null}
                    </span>
                    {canManageSalary ? (
                      <button
                        type="button"
                        className="btn"
                        title="Remove this payment"
                        style={{ padding: '2px 8px' }}
                        onClick={async () => {
                          try {
                            await deleteSalaryPayment(p.id);
                            await reload();
                            toast.success('Payment removed.');
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : 'Could not remove payment',
                            );
                          }
                        }}
                      >
                        ✕
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginTop: 4,
                  paddingTop: 8,
                  borderTop: '1px solid var(--border)',
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
                  Total paid ({payments.length})
                </span>
                <span
                  className="font-display"
                  style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatINR(payments.reduce((acc, p) => acc + p.amountPaise, 0n))}
                </span>
              </div>
            </>
          )}
        </OsCard>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Salary payment form                                                        */
/* -------------------------------------------------------------------------- */

function SalaryPaymentForm({
  employeeId,
  prefillPaise,
  onCancel,
  onCreated,
}: {
  employeeId: string;
  prefillPaise: Paise | null;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const priorMonth = useMemo(() => previousMonthISO(), []);
  const priorMonthLabel = monthName(priorMonth);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [amount, setAmount] = useState(
    prefillPaise && prefillPaise > 0n ? paiseToRupees(prefillPaise) : '',
  );
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  // Auto-fill the amount from last month's attendance-prorated pay. Loads async;
  // never overwrites a value the operator has already typed (`touched`).
  const [touched, setTouched] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoHint, setAutoHint] = useState<string | null>(null);
  // The attendance-prorated salary the employee is DUE for the prior month —
  // snapshotted onto the payment row alongside the amount actually paid.
  const [expectedPaise, setExpectedPaise] = useState<Paise | null>(null);
  // How the salary is being paid out: bank transfer (pick the agency bank) or cash.
  const [mode, setMode] = useState<'bank' | 'cash'>('bank');
  const [bankAccountId, setBankAccountId] = useState('');
  const [ourBanks, setOurBanks] = useState<readonly AgencyBankAccountRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    listAgencyBankAccounts()
      .then((rows) => {
        if (cancelled) return;
        setOurBanks(rows);
        // Preselect the first active bank so the common case is one click.
        const firstActive = rows.find((b) => b.isActive) ?? rows[0];
        if (firstActive) setBankAccountId((cur) => cur || firstActive.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    previewSalaryForEmployee({ employeeId, month: priorMonth })
      .then((res) => {
        if (cancelled) return;
        if (res.hasStructure && res.proratedGrossPaise > 0n) {
          // Only seed the field if the operator hasn't edited it yet.
          setAmount((cur) => (touched ? cur : paiseToRupees(res.proratedGrossPaise)));
          setExpectedPaise(res.proratedGrossPaise);
          setAutoHint(
            `Salary due for ${priorMonthLabel} — ${res.payableDays} of ${res.daysInMonth} days paid (only days marked absent cut pay). Edit the amount if what was actually paid differs; both are stored.`,
          );
        } else {
          setAutoHint(
            `(no attendance/structure data for ${priorMonthLabel} — showing current CTC)`,
          );
        }
      })
      .catch(() => {
        // Fall back silently to the CTC prefill already seeded above.
        if (!cancelled) {
          setAutoHint(
            `(couldn't load ${priorMonthLabel} attendance — showing current CTC)`,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAutoLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount for this employee; `touched` is read fresh via the
    // functional setState so it isn't a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, priorMonth]);

  async function submit() {
    if (!paidOn) {
      toast.error('Pick the date the salary was paid.');
      return;
    }
    if (amount.trim() === '') {
      toast.error('Enter the amount paid.');
      return;
    }
    if (mode === 'bank' && !bankAccountId) {
      toast.error('Pick the bank account the salary was paid from.');
      return;
    }
    setBusy(true);
    try {
      await recordSalaryPayment({
        employeeId,
        paidOn,
        amountPaise: rupeesToPaise(amount),
        expectedAmountPaise: expectedPaise,
        mode,
        bankAccountId: mode === 'bank' ? bankAccountId : null,
        notes: notes.trim() || null,
      });
      toast.success('Salary payment recorded.');
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--content)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
        }}
      >
        <Field label="Date paid">
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label={`Salary due (${priorMonthLabel})`}>
          <input
            type="text"
            value={expectedPaise !== null ? formatINR(expectedPaise) : autoLoading ? '…' : '—'}
            readOnly
            disabled
            title="Attendance-prorated salary the employee is due — stored with the payment."
            style={{ ...inputStyle, color: 'var(--text-muted)' }}
          />
        </Field>
        <Field label="Amount paid (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setTouched(true);
              setAmount(e.target.value);
            }}
            disabled={busy}
            placeholder="60000"
            style={inputStyle}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 600,
          }}
        >
          Paid via
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(['bank', 'cash'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={busy}
              className="btn"
              style={{
                border: `1px solid ${mode === m ? 'var(--apar-red, #E63A1F)' : 'var(--border)'}`,
                background: mode === m ? 'rgba(230,58,31,0.08)' : 'transparent',
              }}
            >
              {m === 'bank' ? 'Bank transfer' : 'Cash'}
            </button>
          ))}
          {mode === 'bank' ? (
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, flex: '1 1 200px' }}
            >
              <option value="">
                {ourBanks.length === 0 ? 'No bank accounts — add one in Settings' : 'Pick a bank'}
              </option>
              {ourBanks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} ••{b.accountLast4}
                  {b.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      <Field label="Note (optional)">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          placeholder="e.g. June 2026 salary"
          style={{ ...inputStyle, width: '100%' }}
        />
      </Field>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        {autoLoading
          ? `Loading ${priorMonthLabel} attendance to pre-fill the amount… `
          : autoHint
            ? `${autoHint} `
            : prefillPaise && prefillPaise > 0n
              ? 'Amount prefilled from the current salary structure — edit to the amount actually paid. '
              : 'Captured as the amount actually disbursed. '}
        Counts toward the cumulative salary deduction shown in the Office app.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Record payment'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Salary breakdown                                                           */
/* -------------------------------------------------------------------------- */

function SalaryBreakdown({ row }: { row: SalaryStructureRow }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="font-display" style={{ fontSize: 24 }}>
          {formatINR(row.ctcMonthlyPaise)}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          per month · effective {formatDay(row.effectiveFrom)}
          {row.effectiveTo ? ` → ${formatDay(row.effectiveTo)}` : ''}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        <Breakdown label="Basic" amount={row.basicPaise} />
        <Breakdown label="HRA" amount={row.hraPaise} />
        <Breakdown label="Special allowance" amount={row.specialAllowancePaise} />
        <Breakdown label="Employer EPF" amount={row.employerEpfPaise} />
        <Breakdown label="Employer ESI" amount={row.employerEsiPaise} />
      </div>
      {row.otherAllowances.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Other allowances
          </span>
          {row.otherAllowances.map((a, i) => (
            <div
              key={`${a.label}-${i}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <span>{a.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatINR(BigInt(a.amountPaise))}
              </span>
            </div>
          ))}
        </div>
      )}
      {row.notes && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--text-muted)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {row.notes}
        </p>
      )}
    </div>
  );
}

function Breakdown({ label, amount }: { label: string; amount: Paise }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div className="font-display" style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
        {formatINR(amount)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* New salary version form                                                    */
/* -------------------------------------------------------------------------- */

function NewSalaryForm({
  employeeId,
  onCancel,
  onCreated,
}: {
  employeeId: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [basic, setBasic] = useState('');
  const [hra, setHra] = useState('');
  const [special, setSpecial] = useState('');
  const [epf, setEpf] = useState('');
  const [esi, setEsi] = useState('');
  const [ctc, setCtc] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  function parseAmount(s: string): bigint {
    if (s.trim() === '') return 0n;
    return rupeesToPaise(s);
  }

  async function submit() {
    if (!effectiveFrom) {
      toast.error('Pick an effective-from date.');
      return;
    }
    if (ctc.trim() === '') {
      toast.error('Monthly CTC is required.');
      return;
    }
    setBusy(true);
    try {
      const ctcPaise = parseAmount(ctc);
      await createSalaryStructure({
        employeeId,
        effectiveFrom,
        basicPaise: parseAmount(basic),
        hraPaise: parseAmount(hra),
        specialAllowancePaise: parseAmount(special),
        employerEpfPaise: parseAmount(epf),
        employerEsiPaise: parseAmount(esi),
        ctcMonthlyPaise: ctcPaise,
        notes: notes.trim() || null,
      });
      toast.success('Salary version saved.');
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save salary');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--content)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
        }}
      >
        <Field label="Effective from">
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="Monthly CTC (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={ctc}
            onChange={(e) => setCtc(e.target.value)}
            disabled={busy}
            placeholder="60000"
            style={inputStyle}
          />
        </Field>
        <Field label="Basic (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={basic}
            onChange={(e) => setBasic(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="HRA (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={hra}
            onChange={(e) => setHra(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="Special allowance (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={special}
            onChange={(e) => setSpecial(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="Employer EPF (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={epf}
            onChange={(e) => setEpf(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label="Employer ESI (₹)">
          <input
            type="text"
            inputMode="decimal"
            value={esi}
            onChange={(e) => setEsi(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          placeholder="e.g. revised after probation"
          style={{ ...inputStyle, width: '100%' }}
        />
      </Field>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
        Captured exactly as per the offer / revision letter — Apar never derives these from a CTC
        formula. Any open prior version is closed on {formatDay(effectiveFrom)}.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save salary version'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Record-bonus form                                                          */
/* -------------------------------------------------------------------------- */

function RecordBonusForm({
  employeeId,
  onCancel,
  onCreated,
}: {
  employeeId: string;
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [kind, setKind] = useState<BonusKind>('bonus');
  const [bonusDate, setBonusDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [taxable, setTaxable] = useState<'captured' | 'taxable' | 'not_taxable'>('captured');
  const [busy, setBusy] = useState(false);

  const requiresAmount = kind !== 'perk_inkind';

  async function submit() {
    if (description.trim() === '') {
      toast.error('Description is required.');
      return;
    }
    if (requiresAmount && amount.trim() === '') {
      toast.error('Amount is required for cash bonuses / perks / gifts / awards.');
      return;
    }
    setBusy(true);
    try {
      await recordBonusOrPerk({
        employeeId,
        kind,
        bonusDate,
        amountPaise: requiresAmount ? rupeesToPaise(amount) : null,
        description: description.trim(),
        taxable,
      });
      toast.success(`${BONUS_KIND_LABEL[kind]} recorded.`);
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--content)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
        }}
      >
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as BonusKind)}
            disabled={busy}
            style={inputStyle}
          >
            {(Object.keys(BONUS_KIND_LABEL) as BonusKind[]).map((k) => (
              <option key={k} value={k}>
                {BONUS_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={bonusDate}
            onChange={(e) => setBonusDate(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </Field>
        <Field label={requiresAmount ? 'Amount (₹)' : 'Amount (in-kind)'}>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy || !requiresAmount}
            placeholder={requiresAmount ? '5000' : '—'}
            style={inputStyle}
          />
        </Field>
        <Field label="Tax treatment">
          <select
            value={taxable}
            onChange={(e) => setTaxable(e.target.value as 'captured' | 'taxable' | 'not_taxable')}
            disabled={busy}
            style={inputStyle}
          >
            <option value="captured">As per letter</option>
            <option value="taxable">Taxable</option>
            <option value="not_taxable">Not taxable</option>
          </select>
        </Field>
      </div>
      <Field label="Description">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          placeholder="Q1 performance bonus / Annual health insurance / Diwali gift"
          style={{ ...inputStyle, width: '100%' }}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Record'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* OS-themed building blocks                                                  */
/* -------------------------------------------------------------------------- */

function OsCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            margin: 0,
            flex: 1,
          }}
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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

const inputStyle: React.CSSProperties = {
  background: 'var(--content)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '6px 8px',
  fontSize: 13,
};

const th: React.CSSProperties = {
  padding: '4px 6px',
  fontWeight: 600,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
};

const td: React.CSSProperties = {
  padding: '6px',
  borderBottom: '1px solid var(--border)',
  fontVariantNumeric: 'tabular-nums',
};
