'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';

type Row = {
  id: string;
  kind: string;
  from: string;
  to: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
};

const TONES: Record<Row['status'], StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function LeaveHistory({ rows }: { rows: readonly Row[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">No applications yet.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40 hover:bg-muted/40">
          <TableHead>Kind</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.kind}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{row.from}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{row.to}</TableCell>
            <TableCell className="text-right tabular-nums">{row.days}</TableCell>
            <TableCell>
              <StatusBadge tone={TONES[row.status]} label={row.status} />
              {row.approvedBy ? (
                <span className="text-muted-foreground ml-1.5 text-xs">by {row.approvedBy}</span>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
