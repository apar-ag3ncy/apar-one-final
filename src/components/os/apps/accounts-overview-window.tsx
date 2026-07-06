'use client';

// Accounts Overview — the top screen of the accounts module, built around the
// "5 boxes and 3 habits" model (Accounts Module Guideline, Part 11):
//
//   Box 1  Money In    — receivables outstanding + income this month
//   Box 2  Money Out   — payables outstanding + costs this month
//   Box 3  GST box     — tax riding on top of prices, passing through us
//   Box 4  TDS box     — tax cut out of payments, parked with the government
//   Box 5  Stuff box   — assets (laptops, phones, printers…)
//
// NOTHING here is static: every amount opens the statement behind it — the
// exact postings (with client/vendor names, document numbers and running
// totals) that produced the number, and every posting opens the full
// double-entry transaction with its invoice/bill. Boxes also break down
// account-by-account so the composition of each figure is visible in place.

import { formatINR } from '@/components/shared/format-inr';
import { getTrialBalance } from '@/lib/server-stub/ledger-actions';
import { getCombinedBankBook, getGstSummary } from '@/lib/server/ledger/report-suite';
import { osActions } from '@/lib/os/store';
import { encodeAccountStatementRoute } from './account-statement-window';
import { ReportWindowFrame, currentFyDefaults, todayIso, useReportData } from './report-window-kit';

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */

function monthStartIso(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

/** Day before the 1st of the current month — the "as of" for opening balances. */
function priorMonthEndIso(today: string): string {
  const d = new Date(`${monthStartIso(today)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Next occurrence of day-of-month `n` (this month if still ahead, else next). */
function nextDueDate(today: string, n: number): string {
  const t = new Date(`${today}T00:00:00Z`);
  const due = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), n));
  if (t.getUTCDate() > n) due.setUTCMonth(due.getUTCMonth() + 1);
  return due.toISOString().slice(0, 10);
}

function monthEndIso(today: string): string {
  const t = new Date(`${today}T00:00:00Z`);
  const end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

function formatDue(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

/* -------------------------------------------------------------------------- */
/* Trial-balance helpers                                                       */
/* -------------------------------------------------------------------------- */

type TbRow = { accountCode: string; accountName: string; debitPaise: bigint; creditPaise: bigint };

/** Asset/expense balance = debit − credit. */
function drBal(rows: readonly TbRow[] | null, ...codes: string[]): bigint {
  if (!rows) return 0n;
  return rows
    .filter((r) => codes.some((c) => r.accountCode.startsWith(c)))
    .reduce((a, r) => a + r.debitPaise - r.creditPaise, 0n);
}

/** Liability/income balance = credit − debit. */
function crBal(rows: readonly TbRow[] | null, ...codes: string[]): bigint {
  if (!rows) return 0n;
  return rows
    .filter((r) => codes.some((c) => r.accountCode.startsWith(c)))
    .reduce((a, r) => a + r.creditPaise - r.debitPaise, 0n);
}

type AccountLine = { code: string; name: string; amount: bigint };

/**
 * Per-account composition for a prefix. `mode: 'balance'` = as-of-today
 * balance; `mode: 'movement'` = this month's movement (today − opening).
 */
function accountBreakdown(
  now: readonly TbRow[] | null,
  open: readonly TbRow[] | null,
  prefix: string,
  positive: 'debit' | 'credit',
  mode: 'balance' | 'movement',
): AccountLine[] {
  if (!now) return [];
  const sign = (r: TbRow) =>
    positive === 'debit' ? r.debitPaise - r.creditPaise : r.creditPaise - r.debitPaise;
  const openMap = new Map((open ?? []).map((r) => [r.accountCode, sign(r)]));
  return now
    .filter((r) => r.accountCode.startsWith(prefix))
    .map((r) => ({
      code: r.accountCode,
      name: r.accountName,
      amount: mode === 'balance' ? sign(r) : sign(r) - (openMap.get(r.accountCode) ?? 0n),
    }))
    .filter((a) => a.amount !== 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

/* -------------------------------------------------------------------------- */
/* Window                                                                      */
/* -------------------------------------------------------------------------- */

export function AccountsOverviewWindow() {
  const today = todayIso();
  const fy = currentFyDefaults();
  const monthKey = today.slice(0, 7);
  const monthStart = monthStartIso(today);
  const openingAsOf = priorMonthEndIso(today);

  // GST compliance always looks one month BACK: the GSTR-1 due on the 11th
  // and the GSTR-3B due on the 20th cover the PREVIOUS month's invoices.
  const prevMonthEnd = openingAsOf;
  const prevMonthKey = prevMonthEnd.slice(0, 7);
  const prevMonthStart = `${prevMonthKey}-01`;
  const prevMonthLabel = new Date(`${prevMonthStart}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });

  const tbNow = useReportData(() => getTrialBalance({ asOfDate: today }), [today]);
  const tbOpen = useReportData(() => getTrialBalance({ asOfDate: openingAsOf }), [openingAsOf]);
  const banks = useReportData(
    () => getCombinedBankBook({ from: fy.fromDate, to: today }),
    [fy.fromDate, today],
  );
  // Fetch from whichever is earlier — the FY start or the previous month —
  // so the filing-period row is present even in April (prev month = last FY).
  const gstFrom = prevMonthStart < fy.fromDate ? prevMonthStart : fy.fromDate;
  const gst = useReportData(() => getGstSummary({ from: gstFrom, to: today }), [gstFrom, today]);

  const now = tbNow.data ?? null;
  const open = tbOpen.data ?? null;

  // Month movement = closing balance − opening balance, per sign convention.
  const incomeMonth = crBal(now, '4') - crBal(open, '4');
  const directCostMonth = drBal(now, '5') - drBal(open, '5');
  const opexMonth = drBal(now, '6') - drBal(open, '6');
  const netMonth = incomeMonth - directCostMonth - opexMonth;

  const receivables = drBal(now, '1200');
  const payables = crBal(now, '2110');
  const gstInput = drBal(now, '1250');
  const tdsReceivable = drBal(now, '1260');
  const tdsPayable = crBal(now, '2130');
  const cash = drBal(now, '1110');

  // Current month — shown in the GST box for context.
  const gstMonth = gst.data?.rows.find((r) => r.month === monthKey) ?? null;
  // Previous month — the period the GSTR-1/3B deadlines actually cover.
  const gstFiling = gst.data?.rows.find((r) => r.month === prevMonthKey) ?? null;

  const loading = tbNow.data === null || tbOpen.data === null;
  const error = tbNow.error ?? tbOpen.error ?? banks.error ?? gst.error;

  /* ---- drill-down openers ------------------------------------------------ */

  function openStatement(opts: {
    codes: readonly string[];
    positive: 'debit' | 'credit';
    title: string;
    from?: string;
    to?: string;
  }) {
    osActions.openWindow({
      app: 'ledger',
      entityId: encodeAccountStatementRoute(opts),
      title: opts.title,
      position: 'beside-focused',
    });
  }

  function openReport(slug: string, title: string) {
    osActions.openWindow({
      app: 'reports',
      entityId: slug,
      title,
      position: 'beside-focused',
    });
  }

  /** Codes under a prefix that actually exist in the books (from the TB). */
  function codesFor(prefix: string): string[] {
    const list = (now ?? [])
      .filter((r) => r.accountCode.startsWith(prefix))
      .map((r) => r.accountCode);
    return list.length > 0 ? list : [`${prefix}000`.slice(0, 4)];
  }

  const monthRange = { from: monthStart, to: today };

  return (
    <ReportWindowFrame
      title="Accounts Overview"
      subtitle="Every rupee lives in one of 5 boxes. Click ANY amount to open the exact transactions behind it; click a transaction to see its double entry and document."
      loading={loading && !now}
      error={error}
    >
      {/* The 3 habits — compliance strip */}
      <section style={sectionStyle}>
        <SectionHeading>Monthly habits</SectionHeading>
        <div style={gridStyle(4)}>
          <HabitCard
            due={`by ${formatDue(nextDueDate(today, 7))}`}
            title="Deposit TDS"
            detail="TDS cut from vendors goes to the government. Click to see each deduction."
            amount={tdsPayable}
            amountLabel="awaiting deposit"
            urgent={tdsPayable > 0n}
            onClick={() =>
              openStatement({
                codes: ['2130'],
                positive: 'credit',
                title: 'TDS Payable — every deduction awaiting deposit',
                to: today,
              })
            }
          />
          <HabitCard
            due={`by ${formatDue(nextDueDate(today, 11))}`}
            title="File GSTR-1"
            detail={`Invoice-level detail of the GST charged in ${prevMonthLabel} — returns always cover the previous month. Click for those invoices.`}
            amount={gstFiling?.outputPaise ?? 0n}
            amountLabel={`output for ${prevMonthLabel}`}
            onClick={() =>
              openStatement({
                codes: ['2120'],
                positive: 'credit',
                title: `Output GST — ${prevMonthLabel}, invoice by invoice`,
                from: prevMonthStart,
                to: prevMonthEnd,
              })
            }
          />
          <HabitCard
            due={`by ${formatDue(nextDueDate(today, 20))}`}
            title="GSTR-3B — pay net GST"
            detail={`GST collected in ${prevMonthLabel} minus the ITC from that month's vendor bills.`}
            amount={gstFiling?.netPayablePaise ?? 0n}
            amountLabel={`net payable for ${prevMonthLabel}`}
            urgent={(gstFiling?.netPayablePaise ?? 0n) > 0n}
            onClick={() => openReport('gst-summary', 'GST Summary')}
          />
          <HabitCard
            due={formatDue(monthEndIso(today))}
            title="Month-end check"
            detail="Did every client deposit the TDS they cut from us? Click for each deduction, then match 26AS/AIS."
            amount={tdsReceivable}
            amountLabel="TDS parked with govt (FY)"
            onClick={() =>
              openStatement({
                codes: ['1260'],
                positive: 'debit',
                title: 'TDS Receivable — what clients deducted, invoice by invoice',
                to: today,
              })
            }
          />
        </div>
      </section>

      {/* The 5 boxes */}
      <section style={sectionStyle}>
        <SectionHeading>The 5 boxes</SectionHeading>
        <div style={gridStyle(3)}>
          <BoxCard title="1 · Money In" hint="Client invoices — income is the base amount only.">
            <Line
              label="Receivables outstanding"
              value={receivables}
              strong
              onClick={() =>
                openStatement({
                  codes: ['1200'],
                  positive: 'debit',
                  title: 'Trade Receivables — who owes us, invoice by invoice',
                  to: today,
                })
              }
            />
            <SubLink label="ageing by client →" onClick={() => openReport('ar-aging', 'AR Aging')} />
            <Line
              label="Income this month"
              value={incomeMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('4'),
                  positive: 'credit',
                  title: `Income — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="Income FY to date"
              value={crBal(now, '4')}
              onClick={() =>
                openStatement({
                  codes: codesFor('4'),
                  positive: 'credit',
                  title: 'Income — FY to date',
                  from: fy.fromDate,
                  to: today,
                })
              }
            />
            <Breakdown
              lines={accountBreakdown(now, open, '4', 'credit', 'movement')}
              caption="this month, by account"
              onOpen={(a) =>
                openStatement({
                  codes: [a.code],
                  positive: 'credit',
                  title: `${a.code} ${a.name} — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
          </BoxCard>

          <BoxCard title="2 · Money Out" hint="Vendor bills, salaries, office spend — base only.">
            <Line
              label="Payables outstanding"
              value={payables}
              strong
              onClick={() =>
                openStatement({
                  codes: ['2110'],
                  positive: 'credit',
                  title: 'Trade Payables — who we owe, bill by bill',
                  to: today,
                })
              }
            />
            <SubLink label="ageing by vendor →" onClick={() => openReport('ap-aging', 'AP Aging')} />
            <Line
              label="Direct costs this month"
              value={directCostMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('5'),
                  positive: 'debit',
                  title: `Direct costs — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="Operating spend this month"
              value={opexMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('6'),
                  positive: 'debit',
                  title: `Operating expenses — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Breakdown
              lines={[
                ...accountBreakdown(now, open, '5', 'debit', 'movement'),
                ...accountBreakdown(now, open, '6', 'debit', 'movement'),
              ]}
              caption="this month, by account"
              onOpen={(a) =>
                openStatement({
                  codes: [a.code],
                  positive: 'debit',
                  title: `${a.code} ${a.name} — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
          </BoxCard>

          <BoxCard
            title="3 · GST box"
            hint="Rides on top of prices. Never our money — just passing through."
          >
            <Line
              label={`Output GST (${prevMonthLabel} — filing period)`}
              value={gstFiling?.outputPaise ?? 0n}
              onClick={() =>
                openStatement({
                  codes: ['2120'],
                  positive: 'credit',
                  title: `Output GST — ${prevMonthLabel}, invoice by invoice`,
                  from: prevMonthStart,
                  to: prevMonthEnd,
                })
              }
            />
            <Line
              label={`Input credit (${prevMonthLabel})`}
              value={gstFiling?.inputPaise ?? 0n}
              onClick={() =>
                openStatement({
                  codes: ['1250'],
                  positive: 'debit',
                  title: `GST Input Credit — ${prevMonthLabel}, bill by bill`,
                  from: prevMonthStart,
                  to: prevMonthEnd,
                })
              }
            />
            <Line
              label={`Net owed to govt (${prevMonthLabel})`}
              value={gstFiling?.netPayablePaise ?? 0n}
              strong
              onClick={() => openReport('gst-summary', 'GST Summary')}
            />
            <Line
              label="Output GST this month (files next month)"
              value={gstMonth?.outputPaise ?? 0n}
              onClick={() =>
                openStatement({
                  codes: ['2120'],
                  positive: 'credit',
                  title: `Output GST — ${monthKey}, invoice by invoice`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="ITC balance on the books"
              value={gstInput}
              onClick={() =>
                openStatement({
                  codes: ['1250'],
                  positive: 'debit',
                  title: 'GST Input Credit — full history',
                  to: today,
                })
              }
            />
            <SubLink
              label="sales register (GSTR-1 detail) →"
              onClick={() => openReport('sales-register', 'Sales Register')}
            />
            <SubLink
              label="purchase register (ITC detail) →"
              onClick={() => openReport('purchase-register', 'Purchase Register')}
            />
          </BoxCard>

          <BoxCard
            title="4 · TDS box"
            hint="Cut out of payments, parked with the government on both sides."
          >
            <Line
              label="We owe by the 7th"
              value={tdsPayable}
              strong
              onClick={() =>
                openStatement({
                  codes: ['2130'],
                  positive: 'credit',
                  title: 'TDS Payable — every deduction we hold',
                  to: today,
                })
              }
            />
            <Line
              label="Parked in our name (clients cut)"
              value={tdsReceivable}
              onClick={() =>
                openStatement({
                  codes: ['1260'],
                  positive: 'debit',
                  title: 'TDS Receivable — what clients deducted',
                  to: today,
                })
              }
            />
            <SubLink
              label="month-by-month summary →"
              onClick={() => openReport('tds-summary', 'TDS Summary')}
            />
          </BoxCard>

          <BoxCard title="5 · Stuff box" hint="Laptops, phones, printers — assets at cost.">
            <Line
              label="Assets on the books"
              value={drBal(now, '15')}
              strong
              onClick={() =>
                openStatement({
                  codes: codesFor('15'),
                  positive: 'debit',
                  title: 'Assets — every purchase on the books',
                  to: today,
                })
              }
            />
            <Breakdown
              lines={accountBreakdown(now, open, '15', 'debit', 'balance')}
              caption="by account"
              onOpen={(a) =>
                openStatement({
                  codes: [a.code],
                  positive: 'debit',
                  title: `${a.code} ${a.name}`,
                  to: today,
                })
              }
            />
          </BoxCard>

          <BoxCard title="This month P&L" hint="Base amounts only — GST and TDS never touch it.">
            <Line
              label="Income"
              value={incomeMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('4'),
                  positive: 'credit',
                  title: `Income — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="Direct costs"
              value={-directCostMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('5'),
                  positive: 'debit',
                  title: `Direct costs — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="Operating expenses"
              value={-opexMonth}
              onClick={() =>
                openStatement({
                  codes: codesFor('6'),
                  positive: 'debit',
                  title: `Operating expenses — ${monthKey}`,
                  ...monthRange,
                })
              }
            />
            <Line
              label="Net"
              value={netMonth}
              strong
              tone={netMonth >= 0n ? 'good' : 'bad'}
              onClick={() => openReport('pnl', 'Profit & Loss')}
            />
            <SubLink label="full P&L →" onClick={() => openReport('pnl', 'Profit & Loss')} />
          </BoxCard>
        </div>
      </section>

      {/* Bank & cash */}
      <section style={sectionStyle}>
        <SectionHeading>Bank &amp; cash</SectionHeading>
        <div style={gridStyle(4)}>
          <BoxCard title="Cash on hand">
            <Line
              label="1110"
              value={cash}
              strong
              onClick={() =>
                openStatement({
                  codes: ['1110'],
                  positive: 'debit',
                  title: 'Cash on Hand — every movement',
                  to: today,
                })
              }
            />
          </BoxCard>
          {(banks.data?.banks ?? []).map((b) => (
            <BoxCard key={b.bankAccountId} title={`${b.label} ••${b.accountLast4}`}>
              <Line
                label={b.bankName}
                value={b.closingPaise}
                strong
                onClick={() => openReport('bank-book-combined', 'Combined Bank Book')}
              />
            </BoxCard>
          ))}
          <BoxCard title="Total cash position">
            <Line
              label="Cash + all banks"
              value={cash + (banks.data?.grandClosingPaise ?? 0n)}
              strong
              onClick={() =>
                osActions.openWindow({
                  app: 'ledger',
                  entityId: 'office',
                  title: 'Office ledger',
                  position: 'beside-focused',
                })
              }
            />
          </BoxCard>
        </div>
      </section>
    </ReportWindowFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Building blocks                                                             */
/* -------------------------------------------------------------------------- */

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

function gridStyle(min: number): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${min <= 3 ? 240 : 200}px, 1fr))`,
    gap: 10,
  };
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontWeight: 600,
        margin: 0,
      }}
    >
      {children}
    </h3>
  );
}

function BoxCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
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
        gap: 8,
        minWidth: 0,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        {hint ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
  onClick,
}: {
  label: string;
  value: bigint;
  strong?: boolean;
  tone?: 'good' | 'bad';
  onClick?: () => void;
}) {
  const color =
    tone === 'good' ? '#7ed099' : tone === 'bad' ? '#e69b9b' : strong ? 'inherit' : 'var(--text)';
  const inner = (
    <>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={strong ? 'font-display' : undefined}
        style={{
          fontSize: strong ? 16 : 12.5,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: strong ? 600 : 500,
          color,
          whiteSpace: 'nowrap',
          borderBottom: onClick ? '1px dotted var(--text-dim)' : 'none',
        }}
      >
        {formatINR(value)}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 10,
        }}
      >
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the transactions behind this number"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 10,
        background: 'none',
        border: 0,
        padding: 0,
        margin: 0,
        width: '100%',
        cursor: 'pointer',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
      }}
    >
      {inner}
    </button>
  );
}

/** Small trailing link inside a box ("ageing by client →"). */
function SubLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 0,
        padding: 0,
        margin: 0,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
        color: 'var(--apar-red, #E63A1F)',
        textAlign: 'left',
        width: 'fit-content',
      }}
    >
      {label}
    </button>
  );
}

/** Account-by-account composition inside a box; each row drills down. */
function Breakdown({
  lines,
  caption,
  onOpen,
}: {
  lines: readonly AccountLine[];
  caption: string;
  onOpen: (line: AccountLine) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 4,
        paddingTop: 6,
        borderTop: '1px dashed var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {caption}
      </span>
      {lines.map((a) => (
        <button
          key={a.code}
          type="button"
          onClick={() => onOpen(a)}
          title={`Open ${a.code} ${a.name}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            width: '100%',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.code}</span> {a.name}
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              borderBottom: '1px dotted var(--text-dim)',
            }}
          >
            {formatINR(a.amount)}
          </span>
        </button>
      ))}
    </div>
  );
}

function HabitCard({
  due,
  title,
  detail,
  amount,
  amountLabel,
  urgent,
  onClick,
}: {
  due: string;
  title: string;
  detail: string;
  amount: bigint;
  amountLabel: string;
  urgent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the detail behind this deadline"
      style={{
        border: `1px solid ${urgent ? 'var(--apar-red, #E63A1F)' : 'var(--border)'}`,
        background: urgent ? 'rgba(230,58,31,0.06)' : 'var(--content-2)',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: urgent ? 'var(--apar-red, #E63A1F)' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {due}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{detail}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          width: '100%',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{amountLabel}</span>
        <span
          className="font-display"
          style={{
            fontSize: 15,
            fontVariantNumeric: 'tabular-nums',
            borderBottom: '1px dotted var(--text-dim)',
          }}
        >
          {formatINR(amount)}
        </span>
      </div>
    </button>
  );
}
