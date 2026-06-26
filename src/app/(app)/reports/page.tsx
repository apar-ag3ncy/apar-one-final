import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ScaleIcon,
  LayersIcon,
  TrendingUpIcon,
  BanknoteIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  FileTextIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Reports · Apar Dashboard',
};

type Report = { slug: string; title: string; description: string; icon: LucideIcon };
type ReportGroup = { heading: string; reports: readonly Report[] };

const GROUPS: readonly ReportGroup[] = [
  {
    heading: 'Financial statements',
    reports: [
      {
        slug: 'trial-balance',
        title: 'Trial Balance',
        description: 'Debit & credit balances across every ledger account.',
        icon: ScaleIcon,
      },
      {
        slug: 'balance-sheet',
        title: 'Balance Sheet',
        description: 'Assets, liabilities and equity as on a date.',
        icon: LayersIcon,
      },
      {
        slug: 'pnl',
        title: 'Profit & Loss',
        description: 'Income and expenses over a period.',
        icon: TrendingUpIcon,
      },
      {
        slug: 'cash-flow',
        title: 'Cash Flow',
        description: 'Cash inflows and outflows by category.',
        icon: BanknoteIcon,
      },
    ],
  },
  {
    heading: 'Receivables & payables',
    reports: [
      {
        slug: 'ar-aging',
        title: 'AR Aging',
        description: 'Outstanding customer receivables by age bucket.',
        icon: ArrowDownLeftIcon,
      },
      {
        slug: 'ap-aging',
        title: 'AP Aging',
        description: 'Outstanding vendor payables by age bucket.',
        icon: ArrowUpRightIcon,
      },
    ],
  },
  {
    heading: 'Ledgers & statements',
    reports: [
      {
        slug: 'bank-book',
        title: 'Bank Book',
        description: 'Bank account movements with running balance.',
        icon: BookOpenIcon,
      },
      {
        slug: 'statement',
        title: 'Statement of Account',
        description: 'Per-party ledger statement for a client or vendor.',
        icon: FileTextIcon,
      },
      {
        slug: 'per-client-pnl',
        title: 'Per-Client P&L',
        description: 'Profitability broken down by client.',
        icon: UsersIcon,
      },
    ],
  },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Pick the question you want answered. Financial statements explain the business overall; receivables/payables show money pending; ledgers show transaction history."
      />
      <div className="bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm">
        Start with <span className="text-foreground font-medium">Profit & Loss</span> for income
        vs expenses, <span className="text-foreground font-medium">Balance Sheet</span> for what
        the company owns/owes, and <span className="text-foreground font-medium">Statement of
        Account</span> when you need one client or vendor&apos;s ledger.
      </div>
      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => (
          <section key={group.heading} className="flex flex-col gap-3">
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {group.heading}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.reports.map((report) => {
                const Icon = report.icon;
                return (
                  <Link
                    key={report.slug}
                    href={`/reports/${report.slug}`}
                    className="group bg-card hover:border-primary/50 hover:bg-accent/40 flex items-start gap-3 rounded-lg border p-4 transition-colors"
                  >
                    <span className="bg-muted text-foreground/80 group-hover:text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{report.title}</span>
                      <span className="text-muted-foreground text-xs leading-snug">
                        {report.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
