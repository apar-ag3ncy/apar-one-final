'use client';

// Office app — tracks the everyday office outflows: stationary, tea/coffee,
// cleaning, leisure, utilities, rent, travel, repairs, and employee
// reimbursements. System-of-record only — amounts are captured from the
// source bill / receipt, never computed (CLAUDE rules #1, #2).

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  listEmployees as listDbEmployees,
  listVendors as listDbVendors,
} from '@/lib/server-stub/entity-actions';
import {
  createOfficeExpense,
  deleteOfficeExpense,
  getOfficeExpenseSummary,
  listOfficeExpenses,
  updateOfficeExpense,
  type OfficeExpenseCategory,
  type OfficeExpensePaymentMethod,
  type OfficeExpenseRow,
  type OfficeExpenseStatus,
  type OfficeExpenseSummary,
} from '@/lib/server/entities/office-expenses';
import { formatINR, paiseToDecimalRupees, parseRupeesToPaise } from '../format';
import { Icon } from '../icons';

type EmployeeOption = { id: string; name: string };
type VendorOption = { id: string; name: string; category: string | null };

const CATEGORY_DEFS: ReadonlyArray<{
  id: OfficeExpenseCategory;
  label: string;
  color: string;
  hint: string;
}> = [
  { id: 'stationary', label: 'Stationary', color: '#5B6677', hint: 'Pens, paper, files' },
  { id: 'toiletries', label: 'Toiletries', color: '#7A4E2D', hint: 'Tissues, soap, hand-wash' },
  { id: 'tea_coffee', label: 'Tea & Coffee', color: '#C46A28', hint: 'Pantry beverages' },
  { id: 'cleaning', label: 'Cleaning', color: '#2E8F5A', hint: 'House-keeping, supplies' },
  { id: 'leisure', label: 'Leisure', color: '#9B3826', hint: 'Team outings, snacks' },
  { id: 'utilities', label: 'Utilities', color: '#D08A1E', hint: 'Power, internet, water' },
  { id: 'rent', label: 'Rent', color: '#7A2D4E', hint: 'Office rent' },
  { id: 'travel', label: 'Travel', color: '#3F4E8E', hint: 'Local cabs, fuel' },
  { id: 'repairs', label: 'Repairs', color: '#1A1411', hint: 'Maintenance, AMC' },
  { id: 'reimbursement', label: 'Reimbursement', color: '#B5391E', hint: 'Paid by employee' },
  { id: 'other', label: 'Other', color: '#5E7344', hint: 'Anything else' },
];

const CATEGORY_INDEX: Record<OfficeExpenseCategory, (typeof CATEGORY_DEFS)[number]> = (() => {
  const m = {} as Record<OfficeExpenseCategory, (typeof CATEGORY_DEFS)[number]>;
  for (const c of CATEGORY_DEFS) m[c.id] = c;
  return m;
})();

const PAYMENT_LABEL: Record<OfficeExpensePaymentMethod, string> = {
  cash: 'Cash',
  bank: 'Bank',
  card: 'Card',
  upi: 'UPI',
  employee_paid: 'Employee paid',
};

const STATUS_LABEL: Record<OfficeExpenseStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  reimbursed: 'Reimbursed',
  rejected: 'Rejected',
};

const STATUS_TONE: Record<OfficeExpenseStatus, 'green' | 'amber' | 'red' | 'slate'> = {
  pending: 'amber',
  approved: 'green',
  reimbursed: 'green',
  rejected: 'red',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function OfficeApp({
  canEdit = true,
  canDelete = true,
}: {
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [rows, setRows] = useState<readonly OfficeExpenseRow[] | null>(null);
  const [summary, setSummary] = useState<OfficeExpenseSummary | null>(null);
  const [employees, setEmployees] = useState<readonly EmployeeOption[]>([]);
  const [vendorOptions, setVendorOptions] = useState<readonly VendorOption[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<OfficeExpenseCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<OfficeExpenseStatus | 'all'>('all');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<OfficeExpenseRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<OfficeExpenseRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [list, sum] = await Promise.all([listOfficeExpenses({}), getOfficeExpenseSummary()]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load office expenses');
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listOfficeExpenses({}), getOfficeExpenseSummary()])
      .then(([list, sum]) => {
        if (cancelled) return;
        setRows(list);
        setSummary(sum);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Could not load office expenses');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listDbEmployees()
      .then((list) => {
        if (cancelled) return;
        setEmployees(
          list
            .filter((e) => e.status === 'active' || e.status === 'notice')
            .map((e) => ({ id: e.id, name: e.fullName })),
        );
      })
      .catch(() => {
        /* employees are optional — the form still works without them */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live vendor directory. The New / Edit Expense form picks from this
  // list; a "one-off seller" option in the dropdown reveals a free-text
  // input for sellers we don't track as proper vendors.
  useEffect(() => {
    let cancelled = false;
    listDbVendors()
      .then((list) => {
        if (cancelled) return;
        setVendorOptions(
          list
            .filter((v) => v.status === 'active')
            .map((v) => ({ id: v.id, name: v.name, category: v.category })),
        );
      })
      .catch(() => {
        /* vendors are optional — falls back to one-off free-text entry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeCategory !== 'all' && r.category !== activeCategory) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.description.toLowerCase().includes(q) ||
        (r.vendorName ?? '').toLowerCase().includes(q) ||
        (r.employeeName ?? '').toLowerCase().includes(q) ||
        (r.referenceNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, activeCategory, statusFilter, search]);

  const topCategory = useMemo(() => {
    if (!summary || summary.byCategory.length === 0) return null;
    return [...summary.byCategory].sort((a, b) =>
      a.totalPaise > b.totalPaise ? -1 : a.totalPaise < b.totalPaise ? 1 : 0,
    )[0]!;
  }, [summary]);

  const filteredTotal = useMemo(
    () => filtered.reduce((acc, r) => acc + r.totalPaise, 0n),
    [filtered],
  );

  async function handleCreate(values: ExpenseFormValues) {
    setBusy(true);
    try {
      await createOfficeExpense(values);
      toast.success('Expense logged.');
      setShowNew(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not log expense');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string, values: ExpenseFormValues) {
    setBusy(true);
    try {
      await updateOfficeExpense({ id, ...values });
      toast.success('Expense updated.');
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update expense');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: OfficeExpenseRow) {
    setBusy(true);
    try {
      await deleteOfficeExpense({ id: row.id });
      toast.success('Expense removed.');
      setConfirmDel(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove expense');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Office</h2>
        <span className="sub">
          {rows ? `${rows.length} entries · ${formatINR(filteredTotal)} in view` : 'Loading…'}
        </span>
        <div className="grow" />
        <div className="search-input">
          <Icon name="search" size={13} />
          <input
            placeholder="Search description, vendor, employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          className="btn primary"
          type="button"
          disabled={!canEdit || busy}
          onClick={() => setShowNew(true)}
          title={canEdit ? undefined : 'You need edit permission to log expenses.'}
        >
          <Icon name="plus" size={13} />
          New Expense
        </button>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
          padding: '14px 20px 4px',
        }}
      >
        <KpiCard
          label="This Month"
          value={summary ? formatINR(summary.monthTotalPaise) : '—'}
          trend={summary ? `${summary.monthCount} entries` : ' '}
        />
        <KpiCard
          label="YTD (FY)"
          value={summary ? formatINR(summary.ytdTotalPaise) : '—'}
          trend="From 01 Apr"
        />
        <KpiCard
          label="Reimbursements pending"
          value={
            summary
              ? `${summary.pendingReimbursementCount} · ${formatINR(summary.pendingReimbursementPaise)}`
              : '—'
          }
          trend="Awaiting approval or payout"
        />
        <KpiCard
          label="Top category (YTD)"
          value={topCategory ? CATEGORY_INDEX[topCategory.category].label : '—'}
          trend={topCategory ? formatINR(topCategory.totalPaise) : ' '}
        />
      </div>

      {/* Category chips */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <CategoryChip
          active={activeCategory === 'all'}
          onClick={() => setActiveCategory('all')}
          color="var(--text-dim)"
          label="All"
          count={rows?.length ?? 0}
        />
        {CATEGORY_DEFS.map((c) => {
          const agg = summary?.byCategory.find((b) => b.category === c.id);
          return (
            <CategoryChip
              key={c.id}
              active={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
              color={c.color}
              label={c.label}
              count={agg?.count ?? 0}
            />
          );
        })}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OfficeExpenseStatus | 'all')}
          style={{
            background: 'var(--content-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 12,
            color: 'var(--text)',
          }}
        >
          <option value="all">All</option>
          {(Object.keys(STATUS_LABEL) as OfficeExpenseStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Expense table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {rows === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            onAction={canEdit ? () => setShowNew(true) : undefined}
            isFiltered={search !== '' || activeCategory !== 'all' || statusFilter !== 'all'}
          />
        ) : (
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Description</th>
                <th>Vendor / Employee</th>
                <th>Payment</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>GST</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const cat = CATEGORY_INDEX[r.category];
                return (
                  <tr key={r.id} className="row-with-actions">
                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(r.expenseDate)}
                    </td>
                    <td>
                      <span
                        className="pill"
                        style={{ background: 'transparent', borderColor: cat.color }}
                      >
                        <span className="dot" style={{ background: cat.color }} />
                        {cat.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.description}</div>
                      {r.referenceNumber && (
                        <div
                          className="font-mono"
                          style={{ fontSize: 11, color: 'var(--text-dim)' }}
                        >
                          {r.referenceNumber}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {r.category === 'reimbursement'
                        ? (r.employeeName ?? '—')
                        : (r.vendorName ?? '—')}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{PAYMENT_LABEL[r.paymentMethod]}</td>
                    <td>
                      <span className={`pill ${STATUS_TONE[r.status]}`}>
                        <span className="dot" />
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatINR(r.amountPaise)}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: r.gstPaise > 0n ? 'var(--text)' : 'var(--text-dim)',
                      }}
                    >
                      {r.gstPaise > 0n ? formatINR(r.gstPaise) : '—'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                      }}
                    >
                      {formatINR(r.totalPaise)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row-actions">
                        {canEdit && (
                          <button
                            className="btn row-action"
                            type="button"
                            title="Edit"
                            onClick={() => setEditing(r)}
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="btn row-action row-delete"
                            type="button"
                            title="Delete"
                            onClick={() => setConfirmDel(r)}
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <ExpenseFormModal
          mode="create"
          employees={employees}
          vendors={vendorOptions}
          onClose={() => setShowNew(false)}
          onSubmit={handleCreate}
          busy={busy}
        />
      )}
      {editing && (
        <ExpenseFormModal
          mode="edit"
          initial={editing}
          employees={employees}
          vendors={vendorOptions}
          onClose={() => setEditing(null)}
          onSubmit={(v) => handleUpdate(editing.id, v)}
          busy={busy}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Remove "${confirmDel.description}"?`}
          message="The entry is soft-deleted. The ledger record (when posted) is unaffected — only this capture row is removed from the Office app list."
          destructive
          confirmLabel="Remove entry"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => handleDelete(confirmDel)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function KpiCard({ label, value, trend }: { label: string; value: ReactNode; trend?: string }) {
  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div className="font-display" style={{ fontSize: 22, marginTop: 4 }}>
        {value}
      </div>
      {trend ? (
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{trend}</div>
      ) : null}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  color,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in oklab, ${color} 18%, transparent)` : 'transparent',
        color: 'var(--text)',
        fontSize: 12,
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      {label}
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{count}</span>
    </button>
  );
}

function EmptyState({ onAction, isFiltered }: { onAction?: () => void; isFiltered: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--content-2)',
          border: '1px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
          marginBottom: 14,
          color: 'var(--text-dim)',
        }}
      >
        <Icon name="filetext" size={22} />
      </div>
      <div className="font-display" style={{ fontSize: 20, color: 'var(--text)' }}>
        {isFiltered ? 'Nothing matches these filters' : 'No office expenses yet'}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, maxWidth: 360 }}>
        {isFiltered
          ? 'Clear the search or category to see the full list.'
          : 'Log the first office expense — stationary, tea-coffee, cleaning supplies, leisure, reimbursements, anything paid from the office tab.'}
      </div>
      {!isFiltered && onAction && (
        <button className="btn primary" type="button" onClick={onAction} style={{ marginTop: 16 }}>
          <Icon name="plus" size={13} />
          New Expense
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Expense form                                                                */
/* -------------------------------------------------------------------------- */

type ExpenseFormValues = {
  expenseDate: string;
  category: OfficeExpenseCategory;
  description: string;
  /** FK to a row in the vendors directory. */
  vendorId: string | null;
  /** Free-text fallback when `vendorId` is null. */
  vendorName: string | null;
  employeeId: string | null;
  amountPaise: bigint;
  gstPaise: bigint;
  paymentMethod: OfficeExpensePaymentMethod;
  status: OfficeExpenseStatus;
  referenceNumber: string | null;
  notes: string | null;
};

const VENDOR_NONE = '__none__';
const VENDOR_OTHER = '__other__';

function ExpenseFormModal({
  mode,
  initial,
  employees,
  vendors,
  onClose,
  onSubmit,
  busy,
}: {
  mode: 'create' | 'edit';
  initial?: OfficeExpenseRow;
  employees: readonly EmployeeOption[];
  vendors: readonly VendorOption[];
  onClose: () => void;
  onSubmit: (values: ExpenseFormValues) => void;
  busy: boolean;
}) {
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? todayIso());
  const [category, setCategory] = useState<OfficeExpenseCategory>(
    initial?.category ?? 'stationary',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  // Initial selection rules:
  //   - row already references a directory vendor → its id
  //   - row has a free-text vendor name → "__other__" with that text preserved
  //   - otherwise → "__none__" (no vendor picked)
  const [vendorSelection, setVendorSelection] = useState<string>(
    initial?.vendorId ?? (initial?.vendorName ? VENDOR_OTHER : VENDOR_NONE),
  );
  const [vendorName, setVendorName] = useState(
    initial?.vendorId ? '' : (initial?.vendorName ?? ''),
  );
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? '');
  const [amountRupees, setAmountRupees] = useState(
    initial ? paiseToDecimalRupees(initial.amountPaise) : '',
  );
  const [gstRupees, setGstRupees] = useState(
    initial ? paiseToDecimalRupees(initial.gstPaise) : '0',
  );
  const [paymentMethod, setPaymentMethod] = useState<OfficeExpensePaymentMethod>(
    initial?.paymentMethod ?? 'bank',
  );
  const [status, setStatus] = useState<OfficeExpenseStatus>(initial?.status ?? 'approved');
  const [referenceNumber, setReferenceNumber] = useState(initial?.referenceNumber ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  // Cascade sensible defaults when the user picks a category during create.
  // Skipped in edit mode so we don't overwrite what's already on the row.
  function changeCategory(next: OfficeExpenseCategory) {
    setCategory(next);
    if (mode !== 'create') return;
    if (next === 'reimbursement') {
      setStatus('pending');
      setPaymentMethod('employee_paid');
    } else {
      setStatus('approved');
      if (paymentMethod === 'employee_paid') setPaymentMethod('bank');
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const desc = description.trim();
    if (!desc) {
      setErr('Description is required.');
      return;
    }
    const amountPaise = parseRupeesToPaise(amountRupees);
    if (amountPaise === null) {
      setErr('Amount must be a valid rupee figure.');
      return;
    }
    const gstPaise = gstRupees.trim() === '' ? 0n : parseRupeesToPaise(gstRupees);
    if (gstPaise === null) {
      setErr('GST must be a valid rupee figure (or empty).');
      return;
    }
    if (amountPaise <= 0n) {
      setErr('Amount must be greater than zero.');
      return;
    }
    if (gstPaise < 0n) {
      setErr('GST cannot be negative.');
      return;
    }
    if (category === 'reimbursement' && !employeeId) {
      setErr('Pick the employee who paid out of pocket.');
      return;
    }

    let vendorId: string | null = null;
    let vendorNameOut: string | null = null;
    if (category !== 'reimbursement') {
      if (vendorSelection === VENDOR_OTHER) {
        const trimmed = vendorName.trim();
        if (!trimmed) {
          setErr('Enter the one-off seller name, or pick a vendor from the list.');
          return;
        }
        vendorNameOut = trimmed;
      } else if (vendorSelection !== VENDOR_NONE) {
        vendorId = vendorSelection;
      }
    }

    onSubmit({
      expenseDate,
      category,
      description: desc,
      vendorId,
      vendorName: vendorNameOut,
      employeeId: employeeId || null,
      amountPaise,
      gstPaise,
      paymentMethod,
      status,
      referenceNumber: referenceNumber.trim() || null,
      notes: notes.trim() || null,
    });
  }

  return (
    <Modal
      title={mode === 'create' ? 'New Office Expense' : 'Edit Office Expense'}
      onClose={onClose}
      width={620}
    >
      <form onSubmit={submit} className="os-form">
        <Field label="Date">
          <input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => changeCategory(e.target.value as OfficeExpenseCategory)}
          >
            {CATEGORY_DEFS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} — {c.hint}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" full>
          <input
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Nescafe pantry restock, 2kg"
          />
        </Field>
        {category === 'reimbursement' ? (
          <Field label="Reimbursed to (employee)">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— Pick an employee —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field
            label="Vendor / supplier"
            hint={
              vendorSelection === VENDOR_OTHER
                ? 'One-off — kirana, restaurant, etc. Add to the Vendors app to make this permanent.'
                : vendors.length === 0
                  ? 'No vendors yet — pick "One-off" or add one in the Vendors app.'
                  : 'Picked from the live Vendors directory.'
            }
          >
            <select
              value={vendorSelection}
              onChange={(e) => {
                const next = e.target.value;
                setVendorSelection(next);
                if (next !== VENDOR_OTHER) setVendorName('');
              }}
            >
              <option value={VENDOR_NONE}>— No vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.category ? ` · ${v.category}` : ''}
                </option>
              ))}
              <option value={VENDOR_OTHER}>+ One-off seller (enter name)…</option>
            </select>
          </Field>
        )}
        {category !== 'reimbursement' && vendorSelection === VENDOR_OTHER && (
          <Field label="One-off seller name" full>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. BigBasket, Mr Subhash, Sai Sagar restaurant"
            />
          </Field>
        )}
        <Field label="Amount (₹)" hint="Pre-tax — captured from the bill.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            placeholder="0.00"
            required
          />
        </Field>
        <Field label="GST (₹)" hint="If the seller levied GST — copy it as printed.">
          <input
            type="number"
            min={0}
            step="0.01"
            value={gstRupees}
            onChange={(e) => setGstRupees(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Payment method">
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as OfficeExpensePaymentMethod)}
          >
            {(Object.keys(PAYMENT_LABEL) as OfficeExpensePaymentMethod[]).map((p) => (
              <option key={p} value={p}>
                {PAYMENT_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as OfficeExpenseStatus)}>
            {(Object.keys(STATUS_LABEL) as OfficeExpenseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bill / receipt no.">
          <input
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="e.g. INV-2618"
            className="font-mono"
          />
        </Field>
        <Field label="Notes" full>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional — extra context, who picked it, etc."
          />
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="check" size={13} />
            {mode === 'create' ? 'Log expense' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal + small bits (kept local — the OS Modal in apps.tsx is not exported) */
/* -------------------------------------------------------------------------- */

function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="os-modal-overlay" onMouseDown={onClose}>
      <div className="os-modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            {title}
          </div>
          <button className="btn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="os-modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  full,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className="os-field" style={full ? { gridColumn: '1 / -1' } : undefined}>
      <span className="os-field-label">{label}</span>
      {children}
      {hint && <span className="os-field-hint">{hint}</span>}
    </label>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <div className="os-form">
        <div
          style={{
            padding: '4px 2px 12px',
            color: 'var(--text-muted)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn primary"
            style={
              destructive
                ? { background: 'var(--apar-red-deep)', borderColor: 'transparent' }
                : undefined
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
