import type { Metadata } from 'next';
import { DownloadIcon } from 'lucide-react';
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
import { formatINR } from '@/components/shared/format-inr';

export const metadata: Metadata = { title: 'My payslips · Apar self-service' };

const PAYSLIPS = [
  { month: 'April 2026', netPaise: 48_000_00n, postedAt: '2026-04-30' },
  { month: 'March 2026', netPaise: 48_000_00n, postedAt: '2026-03-31' },
  { month: 'February 2026', netPaise: 46_000_00n, postedAt: '2026-02-28' },
  { month: 'January 2026', netPaise: 46_000_00n, postedAt: '2026-01-31' },
];

export default function MePayslipsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My payslips</h1>
        <p className="text-muted-foreground text-sm">
          Monthly payslips you can download. Earlier years are in My documents.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Month</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead className="text-right">Net pay</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {PAYSLIPS.map((p) => (
                <TableRow key={p.month}>
                  <TableCell className="font-medium">{p.month}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.postedAt}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatINR(p.netPaise)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm">
                      <DownloadIcon className="mr-1.5 size-3.5" aria-hidden />
                      PDF
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
