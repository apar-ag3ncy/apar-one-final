import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpenIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';

export const metadata: Metadata = {
  title: 'Ledger · Apar Dashboard',
};

export default function LedgerPage() {
  return (
    <>
      <PageHeader
        title="Ledger"
        description="Record source-backed transactions here, then use Reports for balances and statements."
      />
      <EmptyState
        icon={BookOpenIcon}
        title="Choose a ledger entry type"
        description="Use Vendor Bill for vendor invoices, Payment Received for client receipts, Office Expense for overheads, or Journal Voucher for manual debit/credit entries."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/ledger/new/vendor-bill">Vendor bill</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/ledger/new/payment-received">Payment received</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/ledger/new/office-expense">Office expense</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/ledger/new/journal-voucher">Journal voucher</Link>
            </Button>
          </div>
        }
      />
    </>
  );
}
