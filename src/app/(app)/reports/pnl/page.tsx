import type { Metadata } from 'next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINR } from '@/components/shared/format-inr';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ReportShell } from '@/components/shared/report-shell';
import { getTrialBalance } from '@/lib/server-stub/ledger-actions';

export const metadata: Metadata = { title: 'Profit & Loss · Apār Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string; includeReversed?: string }> };

export default async function PnLPage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  const includeReversed = sp.includeReversed === '1';
  const rows = await getTrialBalance({ asOfDate, includeReversed });

  // Revenue: 4xxx (normalSide credit, balance = credit - debit)
  const revenue = rows
    .filter((r) => r.accountCode.startsWith('4'))
    .map((r) => ({ ...r, balance: r.creditPaise - r.debitPaise }));
  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0n);

  // Direct cost: 5xxx
  const directCost = rows
    .filter((r) => r.accountCode.startsWith('5'))
    .map((r) => ({ ...r, balance: r.debitPaise - r.creditPaise }));
  const totalCogs = directCost.reduce((s, r) => s + r.balance, 0n);
  const grossProfit = totalRevenue - totalCogs;

  // OpEx: 6xxx
  const opex = rows
    .filter((r) => r.accountCode.startsWith('6'))
    .map((r) => ({ ...r, balance: r.debitPaise - r.creditPaise }));
  const totalOpex = opex.reduce((s, r) => s + r.balance, 0n);
  const netProfit = grossProfit - totalOpex;

  return (
    <>
      <ProfileHeader
        title="Profit & Loss"
        subtitle="Revenue − direct cost = gross profit. Gross profit − OpEx = net profit. All numbers come from the trial balance — no separate computation."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <ReportShell
        asOfDate={asOfDate}
        includeReversed={includeReversed}
        showIncludeReversed
        basePath="/reports/pnl"
      >
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SectionRow label="Revenue (4xxx)" />
            {revenue.map((r) => (
              <PnLRow
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={r.balance}
              />
            ))}
            <SubtotalRow label="Total revenue" amount={totalRevenue} />

            <SectionRow label="Direct cost (5xxx)" />
            {directCost.map((r) => (
              <PnLRow
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={-r.balance}
              />
            ))}
            <SubtotalRow label="Gross profit" amount={grossProfit} highlight />

            <SectionRow label="Operating expenses (6xxx)" />
            {opex.map((r) => (
              <PnLRow
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={-r.balance}
              />
            ))}
            <SubtotalRow label="Net profit" amount={netProfit} highlight />
          </TableBody>
        </Table>
      </ReportShell>
    </>
  );
}

function PnLRow({ code, name, amount }: { code: string; name: string; amount: bigint }) {
  return (
    <TableRow>
      <TableCell>
        <span className="font-mono text-xs">{code}</span>
        <span className="ml-2">{name}</span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatINR(amount)}</TableCell>
    </TableRow>
  );
}

function SectionRow({ label }: { label: string }) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={2} className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </TableCell>
    </TableRow>
  );
}

function SubtotalRow({
  label,
  amount,
  highlight,
}: {
  label: string;
  amount: bigint;
  highlight?: boolean;
}) {
  return (
    <TableRow className={highlight ? 'bg-muted/20 font-medium' : 'border-t'}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatINR(amount)}</TableCell>
    </TableRow>
  );
}
