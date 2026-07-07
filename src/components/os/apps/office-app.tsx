'use client';

// Office app — tracks the everyday office outflows: stationary, tea/coffee,
// cleaning, leisure, utilities, rent, travel, repairs, and employee
// reimbursements. System-of-record only — amounts are captured from the
// source bill / receipt, never computed (CLAUDE rules #1, #2).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

import {
  listEmployees as listDbEmployees,
  listVendors as listDbVendors,
} from '@/lib/server-stub/entity-actions';
import {
  attachOfficeExpenseInvoice,
  backfillOfficeExpenseLedgerPostings,
  countUnpostedOfficeExpenses,
  createOfficeExpense,
  createOfficeExpenseCategory,
  deleteOfficeExpense,
  getOfficeExpenseSummary,
  importOfficeExpenses,
  deleteOfficeExpenseCategory,
  getOfficeExpenseCategoryUsage,
  listOfficeExpenseCategories,
  reassignOfficeExpenseCategoryEntries,
  listOfficeExpenses,
  removeOfficeExpenseInvoice,
  updateOfficeExpense,
  type ImportOfficeExpenseRow,
  type OfficeExpenseCategory,
  type OfficeExpenseCategoryRow,
  type OfficeExpensePaymentMethod,
  type OfficeExpenseRow,
  type OfficeExpenseStatus,
  type OfficeExpenseSummary,
} from '@/lib/server/entities/office-expenses';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import {
  getSalaryPaymentsSummary,
  type SalaryPaymentsSummary,
} from '@/lib/server/entities/payroll';
import {
  getOpeningBalancesStatus,
  listOpeningBankOptions,
  listPartnerUsers,
  recordOpeningBalances,
  type OpeningBankOption,
  type PartnerOption,
} from '@/lib/server/ledger/opening-balances';
import { formatINR, paiseToDecimalRupees, parseRupeesToPaise } from '../format';
import { Icon } from '../icons';
import { osActions } from '@/lib/os/store';
import { exportRows, paiseToRupees, type ExportFormat } from '@/lib/client/export-rows';
import { OsExportButtons } from './report-window-kit';

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
  // Teal — readable on both the light and dark OS themes (the old near-black
  // #1A1411 vanished against the dark background).
  { id: 'repairs', label: 'Repairs', color: '#2D8A8A', hint: 'Maintenance, AMC' },
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

/** Current financial-year start (India FY = 1 Apr). e.g. Jul 2026 → "2026-04-01". */
function fyStartIso(): string {
  const now = new Date();
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${y}-04-01`;
}

/** Prefix used to encode a custom category selection in the form <select>. */
const CUSTOM_PREFIX = 'custom:';
const CREATE_CATEGORY = '__create__';

/** Date-filter periods offered in the Office expense list. */
type DatePreset = 'all' | 'week' | 'month' | 'last-month' | 'quarter' | 'fy' | 'custom';

const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  all: 'All time',
  week: 'This week',
  month: 'This month',
  'last-month': 'Last month',
  quarter: 'This quarter',
  fy: 'This financial year',
  custom: 'Custom range…',
};

/** Shared look for the toolbar's filter <select>/<input> controls. */
const selectFilterStyle: CSSProperties = {
  background: 'var(--content-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  color: 'var(--text)',
};

/** Resolve a preset (or a custom from/to) to an inclusive [from, to] ISO range.
 * `null` bounds mean "unbounded on that side". Uses the local calendar. */
function dateRangeForPreset(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'week': {
      // Monday–Sunday of the current week.
      const diffToMon = (now.getDay() + 6) % 7;
      const mon = new Date(y, m, now.getDate() - diffToMon);
      const sun = new Date(y, m, now.getDate() - diffToMon + 6);
      return { from: iso(mon), to: iso(sun) };
    }
    case 'month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last-month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'quarter': {
      const qs = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, qs, 1)), to: iso(new Date(y, qs + 3, 0)) };
    }
    case 'fy': {
      // Indian FY: 1 Apr – 31 Mar. Before April, the FY began the prior year.
      const startYear = m >= 3 ? y : y - 1;
      return { from: iso(new Date(startYear, 3, 1)), to: iso(new Date(startYear + 1, 2, 31)) };
    }
    case 'custom':
      return { from: customFrom || null, to: customTo || null };
    default:
      return { from: null, to: null };
  }
}

/**
 * Human-readable category label for an expense row. Custom categories win;
 * built-in "other" rows fall back to their Particulars note; everything else
 * uses the built-in label.
 */
function effectiveCategoryLabel(r: OfficeExpenseRow): string {
  if (r.customCategoryName) return r.customCategoryName;
  if (r.category === 'other' && r.categoryNote) return `Other · ${r.categoryNote}`;
  return CATEGORY_INDEX[r.category].label;
}

/** Dot / pill colour for an expense row — custom colour wins, else the built-in. */
function effectiveCategoryColor(r: OfficeExpenseRow): string {
  return r.customCategoryColor ?? CATEGORY_INDEX[r.category].color;
}

/** Preset swatches offered in the inline "create category" form. */
const CATEGORY_SWATCHES: readonly string[] = [
  '#5B6677',
  '#C46A28',
  '#2E8F5A',
  '#3F4E8E',
  '#7A2D4E',
  '#9B3826',
  '#D08A1E',
  '#5E7344',
];

export function OfficeApp({
  canEdit = false,
  canDelete = false,
}: {
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [rows, setRows] = useState<readonly OfficeExpenseRow[] | null>(null);
  const [summary, setSummary] = useState<OfficeExpenseSummary | null>(null);
  const [salary, setSalary] = useState<SalaryPaymentsSummary | null>(null);
  const [employees, setEmployees] = useState<readonly EmployeeOption[]>([]);
  const [vendorOptions, setVendorOptions] = useState<readonly VendorOption[]>([]);
  const [customCategories, setCustomCategories] = useState<readonly OfficeExpenseCategoryRow[]>([]);
  const [search, setSearch] = useState('');
  // `activeCategory` is 'all', a built-in category id, or `custom:<id>`.
  const [activeCategory, setActiveCategory] = useState<OfficeExpenseCategory | 'all' | string>(
    'all',
  );
  const [statusFilter, setStatusFilter] = useState<OfficeExpenseStatus | 'all'>('all');
  // Date filter — a preset period or a custom from/to range.
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Sort — click a column header to sort by it; click again to flip direction.
  const [sortKey, setSortKey] = useState<'date' | 'amount' | 'total'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<OfficeExpenseRow | null>(null);
  const [confirmDel, setConfirmDel] = useState<OfficeExpenseRow | null>(null);
  const [showOpening, setShowOpening] = useState(false);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [busy, setBusy] = useState(false);
  // Expenses captured before ledger auto-posting (or import-failed) that can
  // still be back-posted to the GL. Drives the "Post N to ledger" button.
  const [unpostedCount, setUnpostedCount] = useState(0);
  const [backfilling, setBackfilling] = useState(false);

  // Re-fetch just the custom categories — called by the inline "create
  // category" flow inside the expense form so a fresh category shows up
  // immediately without reloading the whole app.
  async function reloadCategories(): Promise<readonly OfficeExpenseCategoryRow[]> {
    try {
      const cats = await listOfficeExpenseCategories();
      setCustomCategories(cats);
      return cats;
    } catch {
      return customCategories;
    }
  }

  async function reload() {
    try {
      const [list, sum, sal, cats, unposted] = await Promise.all([
        listOfficeExpenses({}),
        getOfficeExpenseSummary(),
        getSalaryPaymentsSummary(),
        listOfficeExpenseCategories(),
        countUnpostedOfficeExpenses(),
      ]);
      setRows(list);
      setSummary(sum);
      setSalary(sal);
      setCustomCategories(cats);
      setUnpostedCount(unposted);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load office expenses');
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      // Post in small batches, looping client-side, so no single request runs
      // long enough to hit the serverless timeout. Stops when a batch posts
      // nothing new (only unpostable rows remain) or everything is done.
      let posted = 0;
      let skipped = 0;
      for (let guard = 0; guard < 500; guard++) {
        const res = await backfillOfficeExpenseLedgerPostings({ limit: 4 });
        posted += res.posted;
        skipped += res.skipped;
        const remaining = await countUnpostedOfficeExpenses();
        setUnpostedCount(remaining);
        if (res.posted === 0 || remaining === 0) break;
      }
      toast.success(
        skipped > 0
          ? `Posted ${posted} to the ledger · ${skipped} skipped`
          : `Posted ${posted} expense${posted === 1 ? '' : 's'} to the ledger`,
      );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post to ledger');
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listOfficeExpenses({}),
      getOfficeExpenseSummary(),
      getSalaryPaymentsSummary(),
      listOfficeExpenseCategories(),
      countUnpostedOfficeExpenses(),
    ])
      .then(([list, sum, sal, cats, unposted]) => {
        if (cancelled) return;
        setRows(list);
        setSummary(sum);
        setSalary(sal);
        setUnpostedCount(unposted);
        setCustomCategories(cats);
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

  const dateRange = useMemo(
    () => dateRangeForPreset(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  function toggleSort(key: 'date' | 'amount' | 'total') {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const arr = rows.filter((r) => {
      if (activeCategory !== 'all') {
        if (activeCategory.startsWith(CUSTOM_PREFIX)) {
          if (r.customCategoryId !== activeCategory.slice(CUSTOM_PREFIX.length)) return false;
        } else if (r.category !== activeCategory) {
          return false;
        }
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (dateRange.from && r.expenseDate < dateRange.from) return false;
      if (dateRange.to && r.expenseDate > dateRange.to) return false;
      if (!q) return true;
      return (
        r.description.toLowerCase().includes(q) ||
        (r.vendorName ?? '').toLowerCase().includes(q) ||
        (r.employeeName ?? '').toLowerCase().includes(q) ||
        (r.referenceNumber ?? '').toLowerCase().includes(q)
      );
    });
    // Sort is stable, so equal keys keep the server's order (newest insert last).
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'date') {
        cmp = a.expenseDate < b.expenseDate ? -1 : a.expenseDate > b.expenseDate ? 1 : 0;
      } else {
        const av = sortKey === 'amount' ? a.amountPaise : a.totalPaise;
        const bv = sortKey === 'amount' ? b.amountPaise : b.totalPaise;
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, activeCategory, statusFilter, search, dateRange, sortKey, sortDir]);

  const topCategory = useMemo(() => {
    if (!summary || summary.byCategory.length === 0) return null;
    return [...summary.byCategory].sort((a, b) =>
      a.totalPaise > b.totalPaise ? -1 : a.totalPaise < b.totalPaise ? 1 : 0,
    )[0]!;
  }, [summary]);

  // Sums over the rows currently in view — feeds the subheader, the export
  // TOTAL row, and the table's footer total line.
  const filteredTotals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => ({
          amount: acc.amount + r.amountPaise,
          gst: acc.gst + r.gstPaise,
          total: acc.total + r.totalPaise,
        }),
        { amount: 0n, gst: 0n, total: 0n },
      ),
    [filtered],
  );

  async function handleCreate(values: ExpenseFormValues) {
    setBusy(true);
    try {
      // The picked file is a UI-only concern — keep it out of the create call.
      const { invoiceFile, ...expense } = values;
      const row = await createOfficeExpense(expense);
      // Attach the invoice/bill after the expense exists (it needs the row id).
      // A failed upload must not lose the expense — surface it separately.
      if (invoiceFile) {
        try {
          const fd = new FormData();
          fd.append('expenseId', row.id);
          fd.append('file', invoiceFile);
          await attachOfficeExpenseInvoice(fd);
          toast.success('Expense logged with invoice.');
        } catch (upErr) {
          toast.error(
            upErr instanceof Error
              ? `Expense saved, but the invoice didn't upload: ${upErr.message}`
              : "Expense saved, but the invoice didn't upload.",
          );
        }
      } else {
        toast.success('Expense logged.');
      }
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
      // The picked file is a UI-only concern — keep it out of the update call.
      const { invoiceFile, ...expense } = values;
      const row = await updateOfficeExpense({ id, ...expense });
      // Attach a newly-picked invoice/bill after the update succeeds. A failed
      // upload must not lose the edit — surface it separately.
      if (invoiceFile) {
        try {
          const fd = new FormData();
          fd.append('expenseId', row.id);
          fd.append('file', invoiceFile);
          await attachOfficeExpenseInvoice(fd);
          toast.success('Expense updated with invoice.');
        } catch (upErr) {
          toast.error(
            upErr instanceof Error
              ? `Expense saved, but the invoice didn't upload: ${upErr.message}`
              : "Expense saved, but the invoice didn't upload.",
          );
        }
      } else {
        toast.success('Expense updated.');
      }
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

  // Export the rows currently in view (respects the search + category +
  // status filters) as PDF or Excel. Amounts are captured figures, not
  // computed — `paiseToRupees` is a pure unit conversion for the spreadsheet.
  function handleExport(format: ExportFormat) {
    if (filtered.length === 0) return;
    const headers = [
      'Date',
      'Category',
      'Description',
      'Reference',
      'Vendor / Employee',
      'Payment',
      'Status',
      'Amount',
      'GST',
      'Total',
    ];
    const data: Record<string, string | number>[] = filtered.map((r) => ({
      Date: r.expenseDate,
      Category: effectiveCategoryLabel(r),
      Description: r.description,
      Reference: r.referenceNumber ?? '',
      'Vendor / Employee':
        r.category === 'reimbursement' ? (r.employeeName ?? '') : (r.vendorName ?? ''),
      Payment: PAYMENT_LABEL[r.paymentMethod],
      Status: STATUS_LABEL[r.status],
      Amount: paiseToRupees(r.amountPaise),
      GST: paiseToRupees(r.gstPaise),
      Total: paiseToRupees(r.totalPaise),
    }));
    // Footer TOTALS row — sums the captured Amount / GST / Total over the
    // rows in view. Kept as the last row so it lands at the bottom of both
    // the Excel sheet and the PDF table.
    data.push({
      Date: '',
      Category: '',
      Description: 'TOTAL',
      Reference: '',
      'Vendor / Employee': '',
      Payment: '',
      Status: '',
      Amount: paiseToRupees(filteredTotals.amount),
      GST: paiseToRupees(filteredTotals.gst),
      Total: paiseToRupees(filteredTotals.total),
    });
    exportRows(data, headers, `office-expenses-${todayIso()}`, format, 'Office Expenses');
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="main-header">
        <h2>Office</h2>
        <span className="sub">
          {rows ? `${rows.length} entries · ${formatINR(filteredTotals.total)} in view` : 'Loading…'}
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
        <OsExportButtons
          onExport={handleExport}
          disabled={!rows || filtered.length === 0}
        />
        {canEdit && unpostedCount > 0 && (
          <button
            className="btn"
            type="button"
            disabled={backfilling}
            onClick={() => void handleBackfill()}
            title={`Post ${unpostedCount} captured expense${unpostedCount === 1 ? '' : 's'} that aren't in the ledger yet (Dr expense / Cr Cash on Hand)`}
            style={{ color: 'var(--apar-green, #2E8F5A)' }}
          >
            <Icon name="check" size={13} />
            {backfilling ? 'Posting…' : `Post ${unpostedCount} to ledger`}
          </button>
        )}
        <button
          className="btn"
          type="button"
          disabled={!canEdit || busy}
          onClick={() => setShowImport(true)}
          title={canEdit ? 'Import office expenses from an Excel / CSV sheet' : 'You need edit permission to import expenses.'}
        >
          <Icon name="inbox" size={13} />
          Import
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            osActions.openWindow({
              app: 'ledger',
              entityId: 'salary-book',
              title: 'Salary book',
              position: 'beside-focused',
            })
          }
          title="Per-employee salary book"
        >
          <Icon name="book" size={13} />
          Salary book
        </button>
        <button
          className="btn"
          type="button"
          disabled={!canEdit || busy}
          onClick={() => setShowOpening(true)}
          title={
            canEdit
              ? 'Record opening balances — partners/admins only. Seeds cash, bank, assets & partner capital via Opening Balance Equity.'
              : 'You need edit permission to record opening balances.'
          }
        >
          <Icon name="book" size={13} />
          Opening balances
        </button>
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
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
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
          label="Salaries paid"
          value={salary ? formatINR(salary.totalPaise) : '—'}
          trend={
            salary
              ? `${salary.count} payment${salary.count === 1 ? '' : 's'} · deducted from office`
              : ' '
          }
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
        {customCategories.map((c) => {
          const key = `${CUSTOM_PREFIX}${c.id}`;
          const agg = summary?.customByCategory.find((b) => b.id === c.id);
          return (
            <CategoryChip
              key={key}
              active={activeCategory === key}
              onClick={() => setActiveCategory(key)}
              color={c.color ?? agg?.color ?? 'var(--text-dim)'}
              label={c.name}
              count={agg?.count ?? 0}
            />
          );
        })}
        {canEdit && customCategories.length > 0 ? (
          <button
            type="button"
            className="btn"
            style={{ padding: '3px 10px', fontSize: 11.5 }}
            title="Move entries between categories and delete empty ones"
            onClick={() => setShowManageCategories(true)}
          >
            <Icon name="settings" size={12} /> Manage
          </button>
        ) : null}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Dates:</span>
        <select
          value={datePreset}
          onChange={(e) => setDatePreset(e.target.value as DatePreset)}
          style={selectFilterStyle}
        >
          {(Object.keys(DATE_PRESET_LABEL) as DatePreset[]).map((p) => (
            <option key={p} value={p}>
              {DATE_PRESET_LABEL[p]}
            </option>
          ))}
        </select>
        {datePreset === 'custom' && (
          <>
            <input
              type="date"
              aria-label="From date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={selectFilterStyle}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
            <input
              type="date"
              aria-label="To date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              style={selectFilterStyle}
            />
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status:</span>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OfficeExpenseStatus | 'all')}
          style={selectFilterStyle}
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
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px' }}>
        {rows === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            onAction={canEdit ? () => setShowNew(true) : undefined}
            isFiltered={
              search !== '' ||
              activeCategory !== 'all' ||
              statusFilter !== 'all' ||
              datePreset !== 'all'
            }
          />
        ) : (
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <SortableTh
                  label="Date"
                  active={sortKey === 'date'}
                  dir={sortDir}
                  onClick={() => toggleSort('date')}
                />
                <th>Category</th>
                <th>Description</th>
                <th>Vendor / Employee</th>
                <th>Payment</th>
                <th>Status</th>
                <SortableTh
                  label="Amount"
                  align="right"
                  active={sortKey === 'amount'}
                  dir={sortDir}
                  onClick={() => toggleSort('amount')}
                />
                <th style={{ textAlign: 'right' }}>GST</th>
                <SortableTh
                  label="Total"
                  align="right"
                  active={sortKey === 'total'}
                  dir={sortDir}
                  onClick={() => toggleSort('total')}
                />
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const catColor = effectiveCategoryColor(r);
                const catLabel = effectiveCategoryLabel(r);
                return (
                  <tr key={r.id} className="row-with-actions">
                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(r.expenseDate)}
                    </td>
                    <td>
                      <span
                        className="pill"
                        style={{ background: 'transparent', borderColor: catColor }}
                      >
                        <span className="dot" style={{ background: catColor }} />
                        {catLabel}
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
                      {r.posted && (
                        <div
                          title="Posted to the general ledger"
                          style={{
                            fontSize: 10.5,
                            color: 'var(--apar-green, #2E8F5A)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            marginTop: 2,
                          }}
                        >
                          <Icon name="check" size={10} />
                          Posted to ledger
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
                        {r.documentId && (
                          <button
                            className="btn row-action"
                            type="button"
                            title="Download invoice"
                            onClick={async () => {
                              try {
                                const { url } = await getDocumentSignedUrl(r.documentId!);
                                window.open(url, '_blank');
                              } catch (e) {
                                toast.error(
                                  e instanceof Error ? e.message : 'Could not open the invoice',
                                );
                              }
                            }}
                          >
                            <Icon name="download" size={12} />
                          </button>
                        )}
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
            <tfoot>
              {/* Last line: totals over the rows in view. Sticks to the bottom
                  of the scroll area so the running sum is always visible. */}
              <tr>
                <td
                  colSpan={6}
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--content-2)',
                    borderTop: '2px solid var(--border)',
                    padding: '11px 14px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  Total · {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
                </td>
                <td
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--content-2)',
                    borderTop: '2px solid var(--border)',
                    padding: '11px 14px',
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatINR(filteredTotals.amount)}
                </td>
                <td
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--content-2)',
                    borderTop: '2px solid var(--border)',
                    padding: '11px 14px',
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatINR(filteredTotals.gst)}
                </td>
                <td
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--content-2)',
                    borderTop: '2px solid var(--border)',
                    padding: '11px 14px',
                    textAlign: 'right',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatINR(filteredTotals.total)}
                </td>
                <td
                  style={{
                    position: 'sticky',
                    bottom: 0,
                    background: 'var(--content-2)',
                    borderTop: '2px solid var(--border)',
                  }}
                />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {showNew && (
        <ExpenseFormModal
          mode="create"
          employees={employees}
          vendors={vendorOptions}
          customCategories={customCategories}
          onCategoriesChanged={reloadCategories}
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
          customCategories={customCategories}
          onCategoriesChanged={reloadCategories}
          onClose={() => setEditing(null)}
          onSubmit={(v) => handleUpdate(editing.id, v)}
          busy={busy}
        />
      )}
      {showImport && (
        <ImportOfficeExpensesModal
          onClose={() => setShowImport(false)}
          onImported={() => reload()}
        />
      )}
      {showOpening && (
        <OpeningBalancesModal onClose={() => setShowOpening(false)} onPosted={() => reload()} />
      )}
      {showManageCategories && (
        <ManageCategoriesModal
          categories={customCategories}
          canDelete={canDelete}
          onClose={() => setShowManageCategories(false)}
          onChanged={() => reload()}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`Delete "${confirmDel.description}"?`}
          message={
            confirmDel.posted
              ? 'This permanently deletes the expense from the database and reverses its ledger entry (a log of the deletion is kept). This cannot be undone.'
              : 'This permanently deletes the expense from the database (a log of the deletion is kept). This cannot be undone.'
          }
          destructive
          confirmLabel="Delete permanently"
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

/** A clickable column header that sorts the list, showing an ▲/▼ when active. */
function SortableTh({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'right';
}) {
  return (
    <th
      onClick={onClick}
      title={`Sort by ${label.toLowerCase()}`}
      style={{
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        color: active ? 'var(--text)' : undefined,
      }}
    >
      {label}
      <span style={{ opacity: active ? 1 : 0.28, marginLeft: 4 }}>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  );
}

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
  /** FK to a user-defined category; only set when category === 'other'. */
  customCategoryId: string | null;
  /** Free-text "Particulars" for a built-in 'other' expense (no custom cat). */
  categoryNote: string | null;
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
  /** Optional invoice/bill to attach after the expense is saved. UI-only. */
  invoiceFile: File | null;
};

const VENDOR_NONE = '__none__';
const VENDOR_OTHER = '__other__';

function ExpenseFormModal({
  mode,
  initial,
  employees,
  vendors,
  customCategories,
  onCategoriesChanged,
  onClose,
  onSubmit,
  busy,
}: {
  mode: 'create' | 'edit';
  initial?: OfficeExpenseRow;
  employees: readonly EmployeeOption[];
  vendors: readonly VendorOption[];
  customCategories: readonly OfficeExpenseCategoryRow[];
  onCategoriesChanged: () => Promise<readonly OfficeExpenseCategoryRow[]>;
  onClose: () => void;
  onSubmit: (values: ExpenseFormValues) => void;
  busy: boolean;
}) {
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? todayIso());
  // `categorySelection` encodes the dropdown value: a built-in category id,
  // or `custom:<id>` for a user-defined category. Round-trips edit mode.
  const [categorySelection, setCategorySelection] = useState<string>(
    initial?.customCategoryId
      ? `${CUSTOM_PREFIX}${initial.customCategoryId}`
      : (initial?.category ?? 'stationary'),
  );
  // The effective built-in enum value we submit. For a custom category this
  // is always 'other'; for a built-in it's the id itself.
  const category: OfficeExpenseCategory = categorySelection.startsWith(CUSTOM_PREFIX)
    ? 'other'
    : (categorySelection as OfficeExpenseCategory);
  const [categoryNote, setCategoryNote] = useState(initial?.categoryNote ?? '');
  // Inline "create new category" panel state.
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState<string>(CATEGORY_SWATCHES[0]!);
  const [savingCategory, setSavingCategory] = useState(false);
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
  // Optional invoice/bill picked in this form. Uploaded by the parent handler
  // after the expense is saved (attach needs the row id).
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  // Tracks the already-attached invoice in edit mode. Cleared locally when the
  // user hits "Remove" so the UI reflects it without a full reload.
  const [existingDoc, setExistingDoc] = useState<{ id: string; name: string | null } | null>(
    initial?.documentId ? { id: initial.documentId, name: initial.documentName } : null,
  );
  const [removingDoc, setRemovingDoc] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  // Handle a change on the Category <select>. `next` is a built-in id, a
  // `custom:<id>` value, or the sentinel `__create__` (opens the inline
  // create panel). Custom categories map to the built-in 'other' enum for
  // the default cascade.
  function changeCategory(next: string) {
    if (next === CREATE_CATEGORY) {
      setCreatingCategory(true);
      setErr(null);
      return;
    }
    setCategorySelection(next);
    setErr(null);
    if (mode !== 'create') return;
    const effective: OfficeExpenseCategory = next.startsWith(CUSTOM_PREFIX)
      ? 'other'
      : (next as OfficeExpenseCategory);
    if (effective === 'reimbursement') {
      setStatus('pending');
      setPaymentMethod('employee_paid');
    } else {
      setStatus('approved');
      if (paymentMethod === 'employee_paid') setPaymentMethod('bank');
    }
  }

  // Persist a new custom category via the server action, then re-fetch the
  // list in the parent and select the freshly created row. Never submits
  // the surrounding expense form.
  async function saveNewCategory() {
    const name = newCatName.trim();
    if (!name) {
      setErr('Category name is required.');
      return;
    }
    setSavingCategory(true);
    setErr(null);
    try {
      const created = await createOfficeExpenseCategory({ name, color: newCatColor });
      await onCategoriesChanged();
      setCategorySelection(`${CUSTOM_PREFIX}${created.id}`);
      setCreatingCategory(false);
      setNewCatName('');
      setNewCatColor(CATEGORY_SWATCHES[0]!);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the category.');
    } finally {
      setSavingCategory(false);
    }
  }

  // Whether the current selection is a custom (user-defined) category.
  const isCustomCategory = categorySelection.startsWith(CUSTOM_PREFIX);
  const customCategoryId = isCustomCategory
    ? categorySelection.slice(CUSTOM_PREFIX.length)
    : null;
  // Built-in "Other" with no custom category → needs a free-text Particulars.
  const needsParticulars = category === 'other' && !isCustomCategory;

  function submit(e: FormEvent) {
    e.preventDefault();
    // Don't submit the expense while the inline category creator is open.
    if (creatingCategory) {
      setErr('Finish creating the category first, or cancel it.');
      return;
    }
    const desc = description.trim();
    if (!desc) {
      setErr('Description is required.');
      return;
    }
    const particulars = categoryNote.trim();
    if (needsParticulars && !particulars) {
      setErr('Particulars are required for an "Other" expense — describe what it is.');
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
      customCategoryId,
      categoryNote: needsParticulars ? particulars : null,
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
      invoiceFile,
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
        <Field
          label="Category"
          hint={
            isCustomCategory ? 'Custom category — posts to the ledger as "Other".' : undefined
          }
        >
          <select value={categorySelection} onChange={(e) => changeCategory(e.target.value)}>
            {CATEGORY_DEFS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} — {c.hint}
              </option>
            ))}
            {customCategories.length > 0 && (
              <optgroup label="Custom categories">
                {customCategories.map((c) => (
                  <option key={c.id} value={`${CUSTOM_PREFIX}${c.id}`}>
                    {c.name}
                    {c.hint ? ` — ${c.hint}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={CREATE_CATEGORY}>+ Create new category…</option>
          </select>
        </Field>
        {creatingCategory && (
          <div
            className="os-field"
            style={{
              gridColumn: '1 / -1',
              gap: 8,
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--content-2)',
            }}
          >
            <span className="os-field-label">New category</span>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="e.g. Subscriptions, Gifts, Legal fees"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveNewCategory();
                }
              }}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Colour:</span>
              {CATEGORY_SWATCHES.map((sw) => (
                <button
                  key={sw}
                  type="button"
                  aria-label={`Pick ${sw}`}
                  onClick={() => setNewCatColor(sw)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: sw,
                    border:
                      newCatColor === sw
                        ? '2px solid var(--text)'
                        : '2px solid transparent',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                aria-label="Custom colour"
                style={{
                  width: 28,
                  height: 24,
                  padding: 0,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                disabled={savingCategory}
                onClick={() => {
                  setCreatingCategory(false);
                  setNewCatName('');
                  setErr(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={savingCategory || newCatName.trim() === ''}
                onClick={() => void saveNewCategory()}
              >
                <Icon name="check" size={12} />
                {savingCategory ? 'Creating…' : 'Create category'}
              </button>
            </div>
          </div>
        )}
        {needsParticulars && (
          <Field
            label="Particulars — what is this expense?"
            full
            hint="Required for an “Other” expense — a short description of the spend."
          >
            <input
              value={categoryNote}
              onChange={(e) => setCategoryNote(e.target.value)}
              placeholder="e.g. Courier charges, Notary stamp, Domain renewal"
              maxLength={200}
            />
          </Field>
        )}
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
        <Field
          label="Invoice / bill (optional)"
          full
          hint="Attach a scan or photo of the bill — image or PDF."
        >
          {existingDoc && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <Icon name="filetext" size={13} />
              <span style={{ color: 'var(--text)' }}>
                {existingDoc.name ?? 'Attached invoice'}
              </span>
              <button
                type="button"
                className="btn"                onClick={async () => {
                  try {
                    const { url } = await getDocumentSignedUrl(existingDoc.id);
                    window.open(url, '_blank');
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Could not open the invoice.');
                  }
                }}
              >
                <Icon name="download" size={12} />
                Download
              </button>
              <button
                type="button"
                className="btn row-delete"                disabled={removingDoc || !initial}
                onClick={async () => {
                  if (!initial) return;
                  setRemovingDoc(true);
                  setErr(null);
                  try {
                    await removeOfficeExpenseInvoice({ expenseId: initial.id });
                    setExistingDoc(null);
                    toast.success('Invoice removed.');
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : 'Could not remove the invoice.');
                  } finally {
                    setRemovingDoc(false);
                  }
                }}
              >
                <Icon name="trash" size={12} />
                {removingDoc ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
          />
          {invoiceFile && existingDoc && (
            <span className="os-field-hint">
              Uploading a new file will replace the current invoice on save.
            </span>
          )}
        </Field>
        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={busy || creatingCategory || savingCategory}
          >
            <Icon name="check" size={13} />
            {mode === 'create' ? 'Log expense' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Opening balances                                                            */
/* -------------------------------------------------------------------------- */

type OpeningBankLine = { key: string; bankAccountId: string; amount: string };
type OpeningPartnerLine = { key: string; partnerUserId: string; amount: string };

let openingLineSeq = 0;
function nextOpeningKey(): string {
  openingLineSeq += 1;
  return `ln-${openingLineSeq}`;
}

/**
 * Seeds the ledger's opening position: cash on hand (1110), bank balances
 * (1120 sub-ledger), company assets (1510) on the asset side and partner
 * capital (3100) on the equity side. The residual is auto-plugged to
 * Opening Balance Equity (3900) so the entry always balances.
 */
function OpeningBalancesModal({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const [partners, setPartners] = useState<readonly PartnerOption[]>([]);
  const [banks, setBanks] = useState<readonly OpeningBankOption[]>([]);
  const [status, setStatus] = useState<{ alreadyPosted: boolean; postedAt: string | null } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const [asOfDate, setAsOfDate] = useState(fyStartIso());
  const [cashRupees, setCashRupees] = useState('');
  const [assetsRupees, setAssetsRupees] = useState('');
  const [bankLines, setBankLines] = useState<OpeningBankLine[]>([
    { key: nextOpeningKey(), bankAccountId: '', amount: '' },
  ]);
  const [partnerLines, setPartnerLines] = useState<OpeningPartnerLine[]>([
    { key: nextOpeningKey(), partnerUserId: '', amount: '' },
  ]);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPartnerUsers(), listOpeningBankOptions(), getOpeningBalancesStatus()])
      .then(([p, b, s]) => {
        if (cancelled) return;
        setPartners(p);
        setBanks(b);
        setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Could not load opening-balance options');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live totals — parse each rupee input to paise; blank/invalid → 0.
  function toPaise(v: string): bigint {
    const p = parseRupeesToPaise(v);
    return p === null || p < 0n ? 0n : p;
  }
  const cashPaise = toPaise(cashRupees);
  const assetsPaise = toPaise(assetsRupees);
  const banksPaise = bankLines.reduce((acc, l) => acc + toPaise(l.amount), 0n);
  const partnerPaise = partnerLines.reduce((acc, l) => acc + toPaise(l.amount), 0n);
  const totalAssets = cashPaise + banksPaise + assetsPaise;
  // Auto-plug to Opening Balance Equity (3900) so the entry balances.
  const plug = totalAssets - partnerPaise;

  function updateBankLine(key: string, patch: Partial<OpeningBankLine>) {
    setBankLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function updatePartnerLine(key: string, patch: Partial<OpeningPartnerLine>) {
    setPartnerLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      setErr('Pick a valid as-of date.');
      return;
    }
    // Keep only lines that have both a selection and a positive amount.
    const bankOut = bankLines
      .filter((l) => l.bankAccountId && toPaise(l.amount) > 0n)
      .map((l) => ({ bankAccountId: l.bankAccountId, amountPaise: toPaise(l.amount) }));
    const partnerOut = partnerLines
      .filter((l) => l.partnerUserId && toPaise(l.amount) > 0n)
      .map((l) => ({ partnerUserId: l.partnerUserId, amountPaise: toPaise(l.amount) }));

    if (totalAssets <= 0n && partnerOut.length === 0) {
      setErr('Enter at least one opening figure — cash, a bank balance, assets or partner funds.');
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      await recordOpeningBalances({
        asOfDate,
        cashInHandPaise: cashPaise,
        companyAssetsPaise: assetsPaise,
        bankLines: bankOut,
        partnerLines: partnerOut,
        notes: notes.trim() || null,
      });
      toast.success('Opening balances recorded.');
      onPosted();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record opening balances');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Opening balances" onClose={onClose} width={640}>
      {loading ? (
        <div className="os-form">
          <p style={{ color: 'var(--text-muted)', fontSize: 13, gridColumn: '1 / -1' }}>Loading…</p>
        </div>
      ) : (
        <form onSubmit={submit} className="os-form">
          {status?.alreadyPosted && (
            <div
              style={{
                gridColumn: '1 / -1',
                background: 'color-mix(in oklab, var(--amber) 14%, transparent)',
                color: 'var(--amber)',
                border: '1px solid color-mix(in oklab, var(--amber) 40%, transparent)',
                padding: '9px 11px',
                borderRadius: 7,
                fontSize: 12.5,
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Opening balances were already recorded on{' '}
                {status.postedAt ? formatDate(status.postedAt.slice(0, 10)) : 'an earlier date'}.
                Posting again double-counts — reverse the earlier entry first.
              </span>
            </div>
          )}
          <div
            style={{
              gridColumn: '1 / -1',
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            Partners / admins only. Seeds the ledger&apos;s starting position — cash (1110), bank
            balances (1120), company assets (1510) and partner capital (3100). The residual auto-plugs
            to <strong>Opening Balance Equity (3900)</strong> so the entry always balances.
          </div>

          <Field label="As-of date" hint="Usually the financial-year start (1 Apr).">
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              required
            />
          </Field>
          <div />

          <Field label="Cash in hand (₹)" hint="Physical cash — Cash on Hand (1110).">
            <input
              type="number"
              min={0}
              step="0.01"
              value={cashRupees}
              onChange={(e) => setCashRupees(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Company assets (₹)" hint="Equipment & fixtures — Office Assets (1510).">
            <input
              type="number"
              min={0}
              step="0.01"
              value={assetsRupees}
              onChange={(e) => setAssetsRupees(e.target.value)}
              placeholder="0.00"
            />
          </Field>

          {/* Bank balances */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span className="os-field-label">Bank balances (1120)</span>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setBankLines((prev) => [
                    ...prev,
                    { key: nextOpeningKey(), bankAccountId: '', amount: '' },
                  ])
                }
              >
                <Icon name="plus" size={12} />
                Add bank
              </button>
            </div>
            {banks.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                No bank accounts in the 1120 sub-ledger yet.
              </p>
            ) : (
              bankLines.map((l) => (
                <div
                  key={l.key}
                  style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}
                >
                  <select
                    value={l.bankAccountId}
                    onChange={(e) => updateBankLine(l.key, { bankAccountId: e.target.value })}
                    style={{ flex: 2 }}
                  >
                    <option value="">— Pick a bank —</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.amount}
                    onChange={(e) => updateBankLine(l.key, { amount: e.target.value })}
                    placeholder="0.00"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn row-action row-delete"
                    title="Remove"
                    onClick={() =>
                      setBankLines((prev) =>
                        prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev,
                      )
                    }
                    disabled={bankLines.length <= 1}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Partner funds */}
          <div style={{ gridColumn: '1 / -1' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span className="os-field-label">Partner funds (3100)</span>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setPartnerLines((prev) => [
                    ...prev,
                    { key: nextOpeningKey(), partnerUserId: '', amount: '' },
                  ])
                }
              >
                <Icon name="plus" size={12} />
                Add partner
              </button>
            </div>
            {partners.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                No partner users found.
              </p>
            ) : (
              partnerLines.map((l) => (
                <div
                  key={l.key}
                  style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}
                >
                  <select
                    value={l.partnerUserId}
                    onChange={(e) => updatePartnerLine(l.key, { partnerUserId: e.target.value })}
                    style={{ flex: 2 }}
                  >
                    <option value="">— Pick a partner —</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.amount}
                    onChange={(e) => updatePartnerLine(l.key, { amount: e.target.value })}
                    placeholder="0.00"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn row-action row-delete"
                    title="Remove"
                    onClick={() =>
                      setPartnerLines((prev) =>
                        prev.length > 1 ? prev.filter((x) => x.key !== l.key) : prev,
                      )
                    }
                    disabled={partnerLines.length <= 1}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Live balance panel */}
          <div
            style={{
              gridColumn: '1 / -1',
              background: 'var(--content-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 16px',
              fontSize: 12.5,
            }}
          >
            <span style={{ color: 'var(--text-muted)' }}>Total assets (cash + banks + assets)</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatINR(totalAssets)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>Partner funds (3100)</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              {formatINR(partnerPaise)}
            </span>
            <span style={{ color: 'var(--text-muted)', gridColumn: '1 / -1', height: 1 }} />
            <span style={{ color: 'var(--text)' }}>
              Auto-plug → Opening Balance Equity (3900)
            </span>
            <span
              style={{
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
              }}
            >
              {formatINR(plug < 0n ? -plug : plug)}{' '}
              <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 11 }}>
                {plug === 0n
                  ? '(balanced)'
                  : plug > 0n
                    ? 'credit (equity)'
                    : 'debit (contra)'}
              </span>
            </span>
            <span
              style={{
                gridColumn: '1 / -1',
                color: 'var(--text-dim)',
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              The entry always balances — 3900 absorbs the difference between what the office owns
              and what the partners put in.
            </span>
          </div>

          <Field label="Notes" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional — e.g. carried forward from the FY24-25 closing balance sheet."
            />
          </Field>

          {err && <div className="os-form-error">{err}</div>}
          <div className="os-form-actions">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              <Icon name="check" size={13} />
              {submitting ? 'Posting…' : 'Record opening balances'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel / CSV import                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Column aliases for the office-expense import sheet. Each entry lists the
 * accepted header names (normalised — lower-cased, punctuation stripped, spaces
 * collapsed to single spaces) that map onto a logical field. The user's sheet
 * uses headers like "Sr. No", "Date", "Name", "Serial No", "Invoice No",
 * "Unit", "Per Unit (₹)", "Sub Total", "Total", "Category", "Approval",
 * "Payment Mode" — every one of those is covered below.
 */
const IMPORT_COLUMN_ALIASES = {
  srNo: ['sr no', 'sr. no', 'srno', 't no', 't.no', 'tno', 's no', 'sno', 'sl no'],
  date: ['date', 'expense date', 'bill date', 'txn date', 'transaction date'],
  name: ['name', 'description', 'particulars', 'item', 'details', 'expense'],
  serialNo: ['serial no', 'serial number', 'serial', 'sl no'],
  invoiceNo: ['invoice no', 'invoice number', 'invoice', 'bill no', 'bill number', 'inv no'],
  unit: ['unit', 'qty', 'quantity', 'units', 'nos'],
  perUnit: ['per unit', 'per unit (₹)', 'per unit rs', 'rate', 'unit price', 'price'],
  subTotal: ['sub total', 'subtotal', 'sub-total', 'amount'],
  total: ['total', 'total (₹)', 'grand total', 'net total', 'total amount'],
  category: ['category', 'type', 'head', 'expense head'],
  approval: ['approval', 'approved by', 'approver', 'sanctioned by'],
  paymentMode: ['payment mode', 'payment method', 'mode', 'paid via', 'payment'],
} satisfies Record<string, string[]>;

type ImportColumnKey = keyof typeof IMPORT_COLUMN_ALIASES;

/** Normalise a header for case-insensitive alias matching. */
function normaliseImportHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,;:_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First index in `headers` matching any of `aliases` (already normalised). */
function firstImportHeaderIndex(headers: readonly string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a "DD.MM.YY" (or "DD.MM.YYYY", or "DD/MM/YY", or "DD-MM-YY") date into an
 * ISO "YYYY-MM-DD" string. Two-digit years map to 2000+. Also accepts an
 * already-ISO value and a JS Date (SheetJS emits Date objects with cellDates).
 * Returns null when unparseable.
 */
function parseImportDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const day = Number(dd);
    const month = Number(mm);
    let year = Number(yy);
    if (yy!.length === 2) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Map a free-text payment-mode cell onto the {@link OfficeExpensePaymentMethod}
 * enum. Defaults to 'cash' (the user's sheet says "Cash" for most rows). The
 * server maps categories on its own — this only covers the payment column.
 */
function parseImportPaymentMode(raw: string): OfficeExpensePaymentMethod {
  const v = raw.trim().toLowerCase();
  if (!v) return 'cash';
  if (/(cash|hand)/.test(v)) return 'cash';
  if (/(bank|neft|rtgs|imps|cheque|check|transfer|net ?banking)/.test(v)) return 'bank';
  if (/(card|debit|credit|visa|master|rupay)/.test(v)) return 'card';
  if (/(upi|gpay|g pay|google pay|phonepe|paytm|bhim|qr)/.test(v)) return 'upi';
  if (/(employee|reimburse|self|out of pocket|personal)/.test(v)) return 'employee_paid';
  return 'cash';
}

type ImportPreview = {
  rows: ImportOfficeExpenseRow[];
  warnings: Array<{ row: number; message: string }>;
  skipped: number;
  /** Which sheets contributed the rows — for the summary line. */
  sheets: string[];
};

type SheetParseResult =
  | {
      ok: true;
      rows: ImportOfficeExpenseRow[];
      warnings: Array<{ row: number; message: string }>;
      skipped: number;
    }
  | { ok: false; error: string };

/**
 * Parse ONE worksheet into importable office-expense rows. Headers are matched
 * by case-insensitive alias; unreadable rows become warnings, not failures. A
 * sheet with no header / no Name / no amount column returns { ok:false } so a
 * multi-sheet import can skip it and carry on with the rest.
 */
function parseSheetRows(ws: XLSX.WorkSheet): SheetParseResult {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (aoa.length < 2) return { ok: false, error: 'no data rows under a header' };

  const headers = (aoa[0] as unknown[]).map((h) => normaliseImportHeader(String(h ?? '')));
  const colIndex = {} as Record<ImportColumnKey, number>;
  for (const key of Object.keys(IMPORT_COLUMN_ALIASES) as ImportColumnKey[]) {
    colIndex[key] = firstImportHeaderIndex(headers, IMPORT_COLUMN_ALIASES[key]);
  }
  if (colIndex.name === -1) return { ok: false, error: 'no “Name”/“Description” column' };
  if (colIndex.total === -1 && colIndex.subTotal === -1) {
    return { ok: false, error: 'no “Total”/“Sub Total” amount column' };
  }

  const cell = (row: unknown[], key: ImportColumnKey): string => {
    const idx = colIndex[key];
    if (idx === -1) return '';
    return String(row[idx] ?? '').trim();
  };
  const rawCell = (row: unknown[], key: ImportColumnKey): unknown => {
    const idx = colIndex[key];
    if (idx === -1) return '';
    return row[idx];
  };

  const rows: ImportOfficeExpenseRow[] = [];
  const warnings: Array<{ row: number; message: string }> = [];
  let skipped = 0;

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[];
    if (row.every((c) => String(c ?? '').trim() === '')) {
      skipped += 1;
      continue;
    }
    const rowNo = i + 1; // 1-based, header = row 1

    const description = cell(row, 'name');
    if (!description) {
      warnings.push({ row: rowNo, message: 'No Name/Description — skipped.' });
      skipped += 1;
      continue;
    }

    const isoDate = parseImportDate(rawCell(row, 'date'));
    if (!isoDate) {
      warnings.push({ row: rowNo, message: `Unreadable date "${cell(row, 'date')}" — skipped.` });
      skipped += 1;
      continue;
    }

    const totalStr = cell(row, 'total') || cell(row, 'subTotal');
    const amountPaise = parseRupeesToPaise(totalStr.replace(/\s+/g, ''));
    if (amountPaise === null || amountPaise <= 0n) {
      warnings.push({ row: rowNo, message: `Unreadable amount "${totalStr}" — skipped.` });
      skipped += 1;
      continue;
    }

    const invoiceNo = cell(row, 'invoiceNo');
    const serialNo = cell(row, 'serialNo');
    const referenceNumber = invoiceNo || serialNo || null;

    const noteParts: string[] = [];
    const approval = cell(row, 'approval');
    if (approval) noteParts.push(`Approved by: ${approval}`);
    if (serialNo && referenceNumber !== serialNo) noteParts.push(`Serial: ${serialNo}`);
    const unit = cell(row, 'unit');
    const perUnit = cell(row, 'perUnit');
    if (unit) noteParts.push(`Qty: ${unit}`);
    if (perUnit) noteParts.push(`Per unit: ${perUnit}`);

    rows.push({
      expenseDate: isoDate,
      description,
      // Imported expenses are deliberately filed under "Others" — we do NOT
      // auto-create or auto-assign categories from the sheet. The user
      // recategorises them from the list afterwards.
      categoryName: null,
      amountPaise,
      paymentMethod: parseImportPaymentMode(cell(row, 'paymentMode')),
      referenceNumber,
      notes: noteParts.length > 0 ? noteParts.join(' · ') : null,
    });
  }

  return { ok: true, rows, warnings, skipped };
}

/**
 * Bulk-import office expenses from an Excel / CSV sheet. Parses client-side with
 * SheetJS, maps the header row onto columns by case-insensitive alias, shows a
 * preview + warnings, then commits via {@link importOfficeExpenses}. Mirrors the
 * (app)-shell importers (import-employees-dialog / import-attendance-dialog) but
 * dressed in OS chrome (Modal / Field / .btn) — no shadcn.
 */
function ImportOfficeExpensesModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  // Parse every sheet once on upload; toggling the picker just recombines
  // these cached results instead of re-reading the file each time.
  const [sheetInfos, setSheetInfos] = useState<
    readonly { name: string; result: SheetParseResult; count: number }[]
  >([]);
  const [selectedSheets, setSelectedSheets] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Show the sheet picker only when the workbook has more than one sheet.
  const multiSheet = sheetInfos.length > 1;

  function reset() {
    setFile(null);
    setSheetInfos([]);
    setSelectedSheets([]);
    setPreview(null);
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Combine the cached rows of every selected sheet into one preview. */
  function buildPreview(
    infos: readonly { name: string; result: SheetParseResult; count: number }[],
    selected: ReadonlySet<string>,
  ) {
    const multi = infos.length > 1;
    const rows: ImportOfficeExpenseRow[] = [];
    const warnings: Array<{ row: number; message: string }> = [];
    let skipped = 0;
    const sheets: string[] = [];
    for (const info of infos) {
      if (!selected.has(info.name)) continue;
      if (!info.result.ok) {
        warnings.push({ row: 0, message: `Sheet “${info.name}” skipped — ${info.result.error}.` });
        continue;
      }
      sheets.push(info.name);
      rows.push(...info.result.rows);
      skipped += info.result.skipped;
      for (const w of info.result.warnings) {
        warnings.push({
          row: w.row,
          message: multi ? `Sheet “${info.name}” · ${w.message}` : w.message,
        });
      }
    }
    setPreview({ rows, warnings, skipped, sheets });
  }

  function applySelection(next: readonly string[]) {
    setSelectedSheets(next);
    buildPreview(sheetInfos, new Set(next));
  }
  function toggleSheet(name: string) {
    applySelection(
      selectedSheets.includes(name)
        ? selectedSheets.filter((n) => n !== name)
        : [...selectedSheets, name],
    );
  }

  async function handleFile(selected: File) {
    setErr(null);
    setPreview(null);
    setSheetInfos([]);
    setSelectedSheets([]);
    if (!/\.(xlsx|xls|csv)$/i.test(selected.name)) {
      setErr('Pick an Excel (.xlsx, .xls) or CSV file.');
      setFile(null);
      return;
    }
    setFile(selected);
    setParsing(true);
    try {
      const wb = XLSX.read(new Uint8Array(await selected.arrayBuffer()), {
        type: 'array',
        cellDates: true,
      });
      if (wb.SheetNames.length === 0) throw new Error('The workbook has no sheets.');
      const infos = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        const result: SheetParseResult = ws
          ? parseSheetRows(ws)
          : { ok: false, error: 'the sheet is empty' };
        return { name, result, count: result.ok ? result.rows.length : 0 };
      });
      setSheetInfos(infos);

      const importable = infos.filter((i) => i.result.ok && i.count > 0);
      if (importable.length === 0) {
        if (infos.length === 1 && !infos[0]!.result.ok) {
          throw new Error(`This sheet can’t be imported — ${infos[0]!.result.error}.`);
        }
        throw new Error('No sheet has importable rows — check the date and amount columns.');
      }
      // Default: import every sheet that has rows; the picker (multi-sheet
      // only) lets the user narrow it down.
      const defaultSel = importable.map((i) => i.name);
      setSelectedSheets(defaultSel);
      buildPreview(infos, new Set(defaultSel));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read the file.');
      setPreview(null);
      setSheetInfos([]);
    } finally {
      setParsing(false);
    }
  }

  async function commit() {
    if (!preview || preview.rows.length === 0) return;
    setCommitting(true);
    setErr(null);
    try {
      const result = await importOfficeExpenses({ rows: preview.rows });
      const catMsg =
        result.categoriesCreated > 0
          ? ` (${result.categoriesCreated} new categor${result.categoriesCreated === 1 ? 'y' : 'ies'})`
          : '';
      if (result.errors.length > 0) {
        const first = result.errors
          .slice(0, 3)
          .map((e) => `row ${e.row}: ${e.message}`)
          .join('; ');
        toast.warning(
          `Imported ${result.inserted} expense${result.inserted === 1 ? '' : 's'}${catMsg}. ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} failed — ${first}`,
        );
      } else {
        toast.success(
          `Imported ${result.inserted} expense${result.inserted === 1 ? '' : 's'}${catMsg}.`,
        );
      }
      onImported();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not import the expenses.');
    } finally {
      setCommitting(false);
    }
  }

  // Write a sample .xlsx with the header row + two worked example rows.
  function downloadTemplate() {
    const header = [
      'Sr. No',
      'Date',
      'Name',
      'Serial No',
      'Invoice No',
      'Unit',
      'Per Unit (₹)',
      'Sub Total',
      'Total',
      'Category',
      'Approval',
      'Payment Mode',
    ];
    const examples = [
      [
        1,
        '29.01.26',
        'A4 printer paper, 5 reams',
        'SR-1001',
        'INV-2618',
        5,
        '₹350.00',
        '₹1,750.00',
        '₹1,750.00',
        'Office Supplies',
        'Rahul Nair',
        'Cash',
      ],
      [
        2,
        '02.02.26',
        'Office chair',
        'SR-1002',
        'INV-2701',
        1,
        '₹6,500.00',
        '₹6,500.00',
        '₹6,500.00',
        'Asset',
        'Asha Verma',
        'Bank',
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...examples]);
    ws['!cols'] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Office Expenses');
    XLSX.writeFile(wb, 'apar-office-expenses-template.xlsx');
  }

  const rowCount = preview?.rows.length ?? 0;

  return (
    <Modal title="Import office expenses" onClose={onClose} width={720}>
      <div className="os-form">
        <div
          style={{
            gridColumn: '1 / -1',
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}
        >
          Upload an Excel (.xlsx, .xls) or CSV sheet. Columns are matched by name
          — a header row is required. Amounts are read from <strong>Total</strong>{' '}
          (falling back to <strong>Sub Total</strong>); each row is captured as-is.
          If the workbook has more than one sheet, choose which ones to import —
          they&apos;re all brought in together. Every imported expense is filed
          under <strong>Others</strong> — recategorise them from the list afterwards.
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Styled label + hidden file input (no shared OS uploader). */}
          <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
            <Icon name="folder" size={13} />
            {file ? 'Choose a different file' : 'Choose file'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
          </label>
          <button type="button" className="btn" onClick={downloadTemplate}>
            <Icon name="arrowDown" size={13} />
            Download template
          </button>
          {file && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              <Icon name="filetext" size={12} />
              {file.name}
              {parsing ? ' · reading…' : ''}
            </span>
          )}
        </div>

        {multiSheet && (
          <div
            style={{
              gridColumn: '1 / -1',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Which sheets should be imported?</strong>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11.5 }}
                onClick={() =>
                  applySelection(
                    sheetInfos.filter((i) => i.result.ok && i.count > 0).map((i) => i.name),
                  )
                }
              >
                All
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 11.5 }}
                onClick={() => applySelection([])}
              >
                None
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                marginTop: 8,
                maxHeight: 168,
                overflow: 'auto',
              }}
            >
              {sheetInfos.map((info) => {
                const importable = info.result.ok && info.count > 0;
                return (
                  <label
                    key={info.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '5px 4px',
                      fontSize: 12.5,
                      opacity: importable ? 1 : 0.55,
                      cursor: importable ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSheets.includes(info.name)}
                      disabled={!importable}
                      onChange={() => toggleSheet(info.name)}
                    />
                    <span style={{ fontWeight: 600 }}>{info.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                      {importable
                        ? `${info.count} row${info.count === 1 ? '' : 's'}`
                        : info.result.ok
                          ? 'no rows'
                          : `can’t import — ${info.result.error}`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {preview && (
          <>
            <div
              style={{
                gridColumn: '1 / -1',
                fontSize: 12.5,
                color: 'var(--text)',
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <strong>{rowCount}</strong> row{rowCount === 1 ? '' : 's'} ready to import
              {multiSheet && preview.sheets.length > 0 && (
                <span style={{ color: 'var(--text-muted)' }}>
                  · from {preview.sheets.length} sheet{preview.sheets.length === 1 ? '' : 's'}
                </span>
              )}
              {preview.skipped > 0 && (
                <span style={{ color: 'var(--text-muted)' }}>
                  · {preview.skipped} skipped
                </span>
              )}
              {preview.warnings.length > 0 && (
                <span style={{ color: 'var(--amber)' }}>
                  · {preview.warnings.length} warning{preview.warnings.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {preview.warnings.length > 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  background: 'color-mix(in oklab, var(--amber) 12%, transparent)',
                  border: '1px solid color-mix(in oklab, var(--amber) 40%, transparent)',
                  borderRadius: 7,
                  padding: '8px 10px',
                  fontSize: 11.5,
                  color: 'var(--text)',
                  lineHeight: 1.5,
                  maxHeight: 96,
                  overflow: 'auto',
                }}
              >
                {preview.warnings.slice(0, 6).map((w, i) => (
                  <div key={i}>
                    Row {w.row}: {w.message}
                  </div>
                ))}
                {preview.warnings.length > 6 && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    …and {preview.warnings.length - 6} more.
                  </div>
                )}
              </div>
            )}

            <div style={{ gridColumn: '1 / -1', overflow: 'auto', maxHeight: 320 }}>
              <table className="table" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Reference</th>
                    <th>Payment</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {r.expenseDate}
                      </td>
                      <td>{r.description}</td>
                      <td style={{ color: 'var(--text-muted)' }}>Others</td>
                      <td
                        className="font-mono"
                        style={{ fontSize: 11, color: 'var(--text-dim)' }}
                      >
                        {r.referenceNumber ?? '—'}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {r.paymentMethod ? PAYMENT_LABEL[r.paymentMethod] : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatINR(typeof r.amountPaise === 'bigint' ? r.amountPaise : BigInt(r.amountPaise))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rowCount > 20 && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '6px 2px' }}>
                  Showing first 20 of {rowCount} rows.
                </div>
              )}
            </div>
          </>
        )}

        {err && <div className="os-form-error">{err}</div>}
        <div className="os-form-actions">
          {preview && (
            <button type="button" className="btn" onClick={reset} disabled={committing}>
              Clear
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={committing}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void commit()}
            disabled={!preview || rowCount === 0 || committing || parsing}
          >
            <Icon name="check" size={13} />
            {committing ? 'Importing…' : `Import ${rowCount || ''} expense${rowCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal + small bits (kept local — the OS Modal in apps.tsx is not exported) */
/* -------------------------------------------------------------------------- */

/**
 * Manage custom categories: every category shows its all-time entry count;
 * a category with entries offers a BULK "move all entries to …" action
 * (custom or built-in target; posted entries are reversed + reposted when the
 * GL account changes), and only an empty category can be deleted — deleted
 * categories sit in the Trash for 30 days and can be restored.
 */
function ManageCategoriesModal({
  categories,
  canDelete,
  onClose,
  onChanged,
}: {
  categories: readonly OfficeExpenseCategoryRow[];
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [usage, setUsage] = useState<Record<string, number> | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refreshUsage() {
    try {
      const entries = await Promise.all(
        categories.map(async (c) => {
          const u = await getOfficeExpenseCategoryUsage({ id: c.id });
          return [c.id, u.activeCount] as const;
        }),
      );
      setUsage(Object.fromEntries(entries));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load category usage');
    }
  }

  useEffect(() => {
    queueMicrotask(() => void refreshUsage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  async function moveEntries(fromId: string) {
    const target = targets[fromId];
    if (!target) {
      toast.error('Pick the category to move the entries to.');
      return;
    }
    setBusyId(fromId);
    try {
      const args = target.startsWith(CUSTOM_PREFIX)
        ? { fromCategoryId: fromId, toCustomCategoryId: target.slice(CUSTOM_PREFIX.length) }
        : { fromCategoryId: fromId, toCategory: target };
      const res = await reassignOfficeExpenseCategoryEntries(args);
      if (res.failed > 0) {
        toast.error(`Moved ${res.moved}, but ${res.failed} failed — retry to finish the move.`);
      } else {
        toast.success(
          res.reposted > 0
            ? `Moved ${res.moved} entries · ${res.reposted} re-posted to the ledger`
            : `Moved ${res.moved} ${res.moved === 1 ? 'entry' : 'entries'}`,
        );
      }
      await refreshUsage();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move the entries');
    } finally {
      setBusyId(null);
    }
  }

  async function removeCategory(id: string, name: string) {
    setBusyId(id);
    try {
      await deleteOfficeExpenseCategory({ id });
      toast.success(`"${name}" moved to Trash — restorable for 30 days.`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the category');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Manage categories" onClose={onClose} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          A category can only be deleted once it has no entries. If it still has entries, move
          them all to another category first — posted entries are re-posted to the right ledger
          account automatically.
        </p>
        {usage === null ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Loading usage…</p>
        ) : categories.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
            No custom categories yet.
          </p>
        ) : (
          categories.map((c) => {
            const count = usage[c.id] ?? 0;
            const empty = count === 0;
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: c.color ?? 'var(--text-dim)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {count} {count === 1 ? 'entry' : 'entries'}
                </span>
                <div style={{ flex: 1 }} />
                {!empty ? (
                  <>
                    <select
                      value={targets[c.id] ?? ''}
                      onChange={(e) => setTargets((t) => ({ ...t, [c.id]: e.target.value }))}
                      disabled={busy}
                      style={{
                        background: 'var(--content-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 12,
                        color: 'var(--text)',
                        maxWidth: 200,
                      }}
                    >
                      <option value="">Move entries to…</option>
                      {categories
                        .filter((o) => o.id !== c.id)
                        .map((o) => (
                          <option key={o.id} value={`${CUSTOM_PREFIX}${o.id}`}>
                            {o.name}
                          </option>
                        ))}
                      {CATEGORY_DEFS.filter((d) => d.id !== 'reimbursement').map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !targets[c.id]}
                      onClick={() => void moveEntries(c.id)}
                    >
                      {busy ? 'Moving…' : `Move ${count}`}
                    </button>
                  </>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ color: empty ? 'var(--apar-red)' : undefined }}
                    disabled={!empty || busy}
                    title={
                      empty
                        ? 'Delete this category (recoverable from Trash for 30 days)'
                        : 'Move its entries to another category first'
                    }
                    onClick={() => void removeCategory(c.id, c.name)}
                  >
                    <Icon name="trash" size={12} /> Delete
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

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
