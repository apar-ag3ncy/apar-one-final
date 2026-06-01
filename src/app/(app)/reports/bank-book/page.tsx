import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent } from '@/components/ui/card';
import { ReportShell } from '@/components/shared/report-shell';

export const metadata: Metadata = { title: 'Bank book · Apār Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string }> };

export default async function BankBookPage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  return (
    <>
      <ProfileHeader
        title="Bank book"
        subtitle="Chronological list of postings to bank accounts (1100 HDFC, 1110 ICICI, 1150 Cash) with running balance per account."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <ReportShell asOfDate={asOfDate} basePath="/reports/bank-book">
        <Card className="border-0 shadow-none">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Bank book renders once Backend ships `getBankBook(bankAccountId, fromDate, toDate)`. The
            shell + filters are wired so the data adapter is a one-file swap.
          </CardContent>
        </Card>
      </ReportShell>
    </>
  );
}
