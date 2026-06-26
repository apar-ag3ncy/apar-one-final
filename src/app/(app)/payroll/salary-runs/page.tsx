import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { ProfileHeader } from '@/components/entity/profile-header';

export const metadata: Metadata = { title: 'Salary runs · Apar Dashboard' };

// TODO(backend): swap for getSalaryRuns() once A ships.
const RUNS = [
  {
    id: 'sr-26-04',
    month: 'April 2026',
    headCount: 12,
    grossPaise: 8_50_000_00n,
    status: 'posted' as const,
    postedAt: '2026-04-30',
  },
  {
    id: 'sr-26-05',
    month: 'May 2026',
    headCount: 12,
    grossPaise: 8_50_000_00n,
    status: 'draft' as const,
  },
];

export default function SalaryRunsPage() {
  return (
    <>
      <ProfileHeader
        title="Monthly salary runs"
        subtitle="One run per month. Generate from active salary structures, review every line, post atomically — all-or-nothing so failed payroll doesn't leave the GL half-posted."
        back={{ href: '/payroll', label: 'Payroll' }}
        actions={
          <Button asChild>
            <Link href="/payroll/salary-runs/new">New run</Link>
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Head count</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Posted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RUNS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.month}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.headCount}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatINR(r.grossPaise)}
                  </TableCell>
                  <TableCell>
                    {r.status === 'posted' ? (
                      <StatusBadge tone="success" label="Posted" />
                    ) : (
                      <StatusBadge tone="neutral" label="Draft" />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.postedAt ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
