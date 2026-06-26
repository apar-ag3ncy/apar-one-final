import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent } from '@/components/ui/card';
import { ReportShell } from '@/components/shared/report-shell';

export const metadata: Metadata = { title: 'Cash flow · Apar Dashboard' };

type Props = { searchParams: Promise<{ asOf?: string }> };

export default async function CashFlowPage({ searchParams }: Props) {
  const sp = await searchParams;
  const asOfDate = sp.asOf ?? new Date().toISOString().slice(0, 10);
  return (
    <>
      <ProfileHeader
        title="Cash flow"
        subtitle="Inflows and outflows across operating / investing / financing activities. Indirect method, derived from posted transactions."
        back={{ href: '/reports', label: 'All reports' }}
      />
      <ReportShell asOfDate={asOfDate} basePath="/reports/cash-flow">
        <Card className="border-0 shadow-none">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Cash flow renders once Backend ships `getCashFlowStatement(fromDate, toDate)`. Operating
            / investing / financing categorisation comes from the chart-of-accounts domain field.
          </CardContent>
        </Card>
      </ReportShell>
    </>
  );
}
