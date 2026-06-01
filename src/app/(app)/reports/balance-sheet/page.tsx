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

export const metadata: Metadata = { title: 'Balance sheet · Apār Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string }> };

export default async function BalanceSheetPage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await getTrialBalance({ asOfDate });

  const assets = rows
    .filter((r) => r.accountCode.startsWith('1'))
    .map((r) => ({ ...r, balance: r.debitPaise - r.creditPaise }));
  const liabilities = rows
    .filter((r) => r.accountCode.startsWith('2'))
    .map((r) => ({ ...r, balance: r.creditPaise - r.debitPaise }));
  const equity = rows
    .filter((r) => r.accountCode.startsWith('3'))
    .map((r) => ({ ...r, balance: r.creditPaise - r.debitPaise }));

  const totalAssets = assets.reduce((s, r) => s + r.balance, 0n);
  const totalLiab = liabilities.reduce((s, r) => s + r.balance, 0n);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0n);

  return (
    <>
      <ProfileHeader
        title="Balance sheet"
        subtitle="Assets = Liabilities + Equity. Computed from posted GL balances as of the chosen date."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <ReportShell asOfDate={asOfDate} basePath="/reports/balance-sheet">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Section label="Assets (1xxx)" />
            {assets.map((r) => (
              <Row
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={r.balance}
              />
            ))}
            <Subtotal label="Total assets" amount={totalAssets} highlight />

            <Section label="Liabilities (2xxx)" />
            {liabilities.map((r) => (
              <Row
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={r.balance}
              />
            ))}
            <Subtotal label="Total liabilities" amount={totalLiab} />

            <Section label="Equity (3xxx)" />
            {equity.map((r) => (
              <Row
                key={r.accountCode}
                code={r.accountCode}
                name={r.accountName}
                amount={r.balance}
              />
            ))}
            <Subtotal label="Total equity" amount={totalEquity} />
            <Subtotal label="Liabilities + Equity" amount={totalLiab + totalEquity} highlight />
          </TableBody>
        </Table>
      </ReportShell>
    </>
  );
}

function Row({ code, name, amount }: { code: string; name: string; amount: bigint }) {
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

function Section({ label }: { label: string }) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={2} className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
      </TableCell>
    </TableRow>
  );
}

function Subtotal({
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
