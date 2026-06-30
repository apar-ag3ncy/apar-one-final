import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRightIcon } from 'lucide-react';

import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent } from '@/components/ui/card';
import { BankingClient } from './banking-client';

export const metadata: Metadata = { title: 'Banking · Apar Dashboard' };

export default function BankingPage() {
  return (
    <>
      <ProfileHeader
        title="Banking"
        subtitle="Your bank accounts, their opening balances, and the running balance from every payment posted to the ledger. Balances here tally with the books."
      />
      <div className="flex flex-col gap-4">
        <BankingClient />
        <Link href="/banking/reconcile">
          <Card className="hover:bg-muted/40 hover:border-primary/40 transition-colors">
            <CardContent className="flex items-center gap-3 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Reconcile a statement</p>
                <p className="text-muted-foreground text-xs">
                  Upload a bank statement and match it against posted transactions.
                </p>
              </div>
              <ArrowRightIcon className="text-muted-foreground size-4" aria-hidden />
            </CardContent>
          </Card>
        </Link>
      </div>
    </>
  );
}
