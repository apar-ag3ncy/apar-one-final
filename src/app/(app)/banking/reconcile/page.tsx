import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRightIcon, LandmarkIcon } from 'lucide-react';
import { ProfileHeader } from '@/components/entity/profile-header';

export const metadata: Metadata = { title: 'Bank reconciliation · Apār Dashboard' };

// TODO(backend): swap to a server query returning agency bank accounts.
const BANKS = [
  { id: '1100', label: 'HDFC Current — XXXX 1234' },
  { id: '1110', label: 'ICICI Current — XXXX 5678' },
];

export default function BankReconcileIndexPage() {
  return (
    <>
      <ProfileHeader
        title="Bank reconciliation"
        subtitle="Pick a bank account to reconcile. Upload the bank's statement; we auto-match against posted transactions and let you manually pair the rest."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {BANKS.map((bank) => (
          <Link key={bank.id} href={`/banking/reconcile/${bank.id}`}>
            <Card className="hover:bg-muted/40 hover:border-primary/40 transition-colors">
              <CardContent className="flex items-center gap-3 py-4">
                <LandmarkIcon className="size-5 opacity-70" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{bank.label}</p>
                  <p className="text-muted-foreground text-xs">Account code {bank.id}</p>
                </div>
                <ArrowRightIcon className="text-muted-foreground size-4" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
