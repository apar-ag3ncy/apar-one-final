import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRightIcon,
  BanknoteIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HandCoinsIcon,
  LandmarkIcon,
  PencilIcon,
  ReceiptIcon,
  RepeatIcon,
  StoreIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ProfileHeader } from '@/components/entity/profile-header';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'New transaction · Apar Dashboard' };

type Tile = {
  href: string;
  title: string;
  description: string;
  icon: typeof BanknoteIcon;
  partnerOnly?: boolean;
};

const TILES: readonly Tile[] = [
  {
    href: '/ledger/new/vendor-bill',
    title: 'Vendor bill',
    description: 'AP entry. Attribution gate decides client / OpEx / asset.',
    icon: StoreIcon,
  },
  {
    href: '/ledger/new/client-invoice',
    title: 'Client invoice',
    description: 'AR entry. GST captured per line; HSN required.',
    icon: ReceiptIcon,
  },
  {
    href: '/ledger/new/payment-received',
    title: 'Payment received',
    description: 'Bank in. Apply to invoices or post to 2180 Advances.',
    icon: BanknoteIcon,
  },
  {
    href: '/ledger/new/payment-made',
    title: 'Payment made',
    description: 'Bank out. Settle vendor bill or employee reimbursement.',
    icon: HandCoinsIcon,
  },
  {
    href: '/ledger/new/advance-received',
    title: 'Advance received',
    description: 'Pre-invoice money. Posts to 2180, not 1200.',
    icon: BanknoteIcon,
  },
  {
    href: '/ledger/new/expense-on-behalf',
    title: 'Expense on behalf',
    description: 'Spend Apar covers for a client. Bills back separately.',
    icon: ClipboardCheckIcon,
  },
  {
    href: '/ledger/new/office-expense',
    title: 'Office expense',
    description: 'Petty cash, SaaS, rent. No vendor counterparty needed.',
    icon: ReceiptIcon,
  },
  {
    href: '/ledger/new/inter-bank-transfer',
    title: 'Inter-bank transfer',
    description: 'Sweep between agency accounts.',
    icon: RepeatIcon,
  },
  {
    href: '/ledger/new/journal-voucher',
    title: 'Journal voucher',
    description: 'Free-form double-entry. Partner-only.',
    icon: PencilIcon,
    partnerOnly: true,
  },
  {
    href: '/banking/reconcile',
    title: 'Bank reconciliation',
    description: 'Upload a statement and match against postings.',
    icon: LandmarkIcon,
  },
  {
    href: '/ledger/new/salary-run',
    title: 'Salary run',
    description: 'Monthly payroll. See Phase 4.5 Payroll UI.',
    icon: FileTextIcon,
  },
];

export default function NewTransactionIndexPage() {
  return (
    <>
      <ProfileHeader
        title="Create transaction"
        subtitle="Every typed kind has its own form so validation flags fire correctly. Reach for Journal voucher only when nothing else fits."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Tile key={tile.href} tile={tile} />
        ))}
      </div>
    </>
  );
}

function Tile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link href={tile.href}>
      <Card
        className={cn(
          'hover:bg-muted/40 hover:border-primary/40 transition-colors',
          tile.partnerOnly && 'border-amber-200/60',
        )}
      >
        <CardContent className="flex items-start gap-3 py-4">
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-md">
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="font-medium">{tile.title}</p>
              <ArrowRightIcon className="text-muted-foreground size-4" aria-hidden />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{tile.description}</p>
            {tile.partnerOnly ? <p className="mt-1 text-xs text-amber-600">Partner-only</p> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
