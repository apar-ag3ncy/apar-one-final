import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { ReimbursementSubmitForm } from './reimbursement-submit-form';

export const metadata: Metadata = { title: 'My reimbursements · Apār self-service' };

const HISTORY = [
  {
    id: 'r1',
    submittedAt: '2026-05-14',
    summary: 'Client site visit · cab + meals',
    amountPaise: 4_250_00n,
    status: 'pending' as const,
  },
  {
    id: 'r2',
    submittedAt: '2026-04-22',
    summary: 'Adobe license renewal',
    amountPaise: 7_500_00n,
    status: 'approved' as const,
  },
  {
    id: 'r3',
    submittedAt: '2026-04-08',
    summary: 'Office stationery',
    amountPaise: 1_200_00n,
    status: 'approved' as const,
  },
];

const TONES: Record<(typeof HISTORY)[number]['status'], StatusTone> = {
  pending: 'warning',
  approved: 'success',
};

export default function MeReimbursementsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My reimbursements</h1>
        <p className="text-muted-foreground text-sm">
          Submit receipts and track approval. Approved items pay out with your next salary.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit a new reimbursement</CardTitle>
          </CardHeader>
          <CardContent>
            <ReimbursementSubmitForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Submitted</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {HISTORY.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground text-xs">{r.submittedAt}</TableCell>
                    <TableCell>{r.summary}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINR(r.amountPaise)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={TONES[r.status]} label={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
