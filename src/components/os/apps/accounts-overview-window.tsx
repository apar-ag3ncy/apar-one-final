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
// Habits strip: deposit TDS by the 7th · GSTR-1 by the 11th · GSTR-3B + pay
// net GST by the 20th · month-end: check clients deposited the TDS they cut.
//
// Everything here is a read over the single transactions store (trial
// balance + the GST/TDS monthly summaries + the combined bank book) — no
// second copy of any book.

import { formatINR } from '@/components/shared/format-inr';
import { getTrialBalance } from '@/lib/server-stub/ledger-actions';
import { getCombinedBankBook, getGstSummary } from '@/lib/server/ledger/report-suite';
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

type TbRow = { accountCode: string; debitPaise: bigint; creditPaise: bigint };

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

/* -------------------------------------------------------------------------- */
/* Window                                                                      */
/* -------------------------------------------------------------------------- */

export function AccountsOverviewWindow() {
  const today = todayIso();
  const fy = currentFyDefaults();
  const monthKey = today.slice(0, 7);
  const openingAsOf = priorMonthEndIso(today);

  const tbNow = useReportData(() => getTrialBalance({ asOfDate: today }), [today]);
  const tbOpen = useReportData(() => getTrialBalance({ asOfDate: openingAsOf }), [openingAsOf]);
  const banks = useReportData(
    () => getCombinedBankBook({ from: fy.fromDate, to: today }),
    [fy.fromDate, today],
  );
  const gst = useReportData(() => getGstSummary({ from: fy.fromDate, to: today }), [
    fy.fromDate,
    today,
  ]);

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
  const assets = drBal(now, '1510');
  const cash = drBal(now, '1110');

  const gstMonth = gst.data?.rows.find((r) => r.month === monthKey) ?? null;

  const loading = tbNow.data === null || tbOpen.data === null;
  const error = tbNow.error ?? tbOpen.error ?? banks.error ?? gst.error;

  return (
    <ReportWindowFrame
      title="Accounts Overview"
      subtitle="Every rupee lives in one of 5 boxes. The habits strip is what keeps the tax boxes empty."
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
            detail="TDS cut from vendors last month goes to the government."
            amount={tdsPayable}
            amountLabel="awaiting deposit"
            urgent={tdsPayable > 0n}
          />
          <HabitCard
            due={`by ${formatDue(nextDueDate(today, 11))}`}
            title="File GSTR-1"
            detail="Invoice-level detail of the GST charged this month."
            amount={gstMonth?.outputPaise ?? 0n}
            amountLabel="output this month"
          />
          <HabitCard
            due={`by ${formatDue(nextDueDate(today, 20))}`}
            title="GSTR-3B — pay net GST"
            detail="GST collected minus GST vendors charged us."
            amount={gstMonth?.netPayablePaise ?? 0n}
            amountLabel="net payable"
            urgent={(gstMonth?.netPayablePaise ?? 0n) > 0n}
          />
          <HabitCard
            due={formatDue(monthEndIso(today))}
            title="Month-end check"
            detail="Did every client actually deposit the TDS they cut from us? Match 26AS/AIS."
            amount={tdsReceivable}
            amountLabel="TDS parked with govt (FY)"
          />
        </div>
      </section>

      {/* The 5 boxes */}
      <section style={sectionStyle}>
        <SectionHeading>The 5 boxes</SectionHeading>
        <div style={gridStyle(3)}>
          <BoxCard title="1 · Money In" hint="Client invoices — income is the base amount only.">
            <Line label="Receivables outstanding" value={receivables} strong />
            <Line label="Income this month" value={incomeMonth} />
            <Line label="Income FY to date" value={crBal(now, '4')} />
          </BoxCard>
          <BoxCard title="2 · Money Out" hint="Vendor bills, salaries, office spend — base only.">
            <Line label="Payables outstanding" value={payables} strong />
            <Line label="Direct costs this month" value={directCostMonth} />
            <Line label="Operating spend this month" value={opexMonth} />
          </BoxCard>
          <BoxCard
            title="3 · GST box"
            hint="Rides on top of prices. Never our money — just passing through."
          >
            <Line label="Output GST this month" value={gstMonth?.outputPaise ?? 0n} />
            <Line label="Input credit this month" value={gstMonth?.inputPaise ?? 0n} />
            <Line label="Net owed to govt (month)" value={gstMonth?.netPayablePaise ?? 0n} strong />
            <Line label="ITC balance on the books" value={gstInput} />
          </BoxCard>
          <BoxCard
            title="4 · TDS box"
            hint="Cut out of payments, parked with the government on both sides."
          >
            <Line label="We owe by the 7th" value={tdsPayable} strong />
            <Line label="Parked in our name (clients cut)" value={tdsReceivable} />
          </BoxCard>
          <BoxCard title="5 · Stuff box" hint="Laptops, phones, printers — assets at cost.">
            <Line label="Assets on the books" value={assets} strong />
          </BoxCard>
          <BoxCard title="This month P&L" hint="Base amounts only — GST and TDS never touch it.">
            <Line label="Income" value={incomeMonth} />
            <Line label="Direct costs" value={-directCostMonth} />
            <Line label="Operating expenses" value={-opexMonth} />
            <Line label="Net" value={netMonth} strong tone={netMonth >= 0n ? 'good' : 'bad'} />
          </BoxCard>
        </div>
      </section>

      {/* Bank & cash */}
      <section style={sectionStyle}>
        <SectionHeading>Bank &amp; cash</SectionHeading>
        <div style={gridStyle(4)}>
          <BoxCard title="Cash on hand">
            <Line label="1110" value={cash} strong />
          </BoxCard>
          {(banks.data?.banks ?? []).map((b) => (
            <BoxCard key={b.bankAccountId} title={`${b.label} ••${b.accountLast4}`}>
              <Line label={b.bankName} value={b.closingPaise} strong />
            </BoxCard>
          ))}
          <BoxCard title="Total cash position">
            <Line label="Cash + all banks" value={cash + (banks.data?.grandClosingPaise ?? 0n)} strong />
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
}: {
  label: string;
  value: bigint;
  strong?: boolean;
  tone?: 'good' | 'bad';
}) {
  const color =
    tone === 'good' ? '#7ed099' : tone === 'bad' ? '#e69b9b' : strong ? 'inherit' : 'var(--text)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={strong ? 'font-display' : undefined}
        style={{
          fontSize: strong ? 16 : 12.5,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: strong ? 600 : 500,
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {formatINR(value)}
      </span>
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
}: {
  due: string;
  title: string;
  detail: string;
  amount: bigint;
  amountLabel: string;
  urgent?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${urgent ? 'var(--apar-red, #E63A1F)' : 'var(--border)'}`,
        background: urgent ? 'rgba(230,58,31,0.06)' : 'var(--content-2)',
        borderRadius: 10,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{amountLabel}</span>
        <span
          className="font-display"
          style={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}
        >
          {formatINR(amount)}
        </span>
      </div>
    </div>
  );
}
