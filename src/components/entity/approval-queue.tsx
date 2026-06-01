'use client';

import { useState } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';
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
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';

export type ApprovalRow = {
  id: string;
  /** "Anjali Mehta" — display name of the requester. */
  requester: string;
  /** Submitted-on date string. */
  submittedAt: string;
  /** Free-form summary ("Travel to client site · ₹4,250"). */
  summary: string;
  /** Right-side detail rendered into a cell. Use this for amount, dates, etc. */
  detail: React.ReactNode;
  /** Current state. */
  status: 'pending' | 'approved' | 'rejected';
};

export type ApprovalQueueProps = {
  title: string;
  rows: readonly ApprovalRow[];
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Capability gate; when false, buttons are hidden. */
  canApprove?: boolean;
  /** Empty-state copy. */
  emptyMessage?: string;
};

const TONES: Record<ApprovalRow['status'], StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export function ApprovalQueue({
  title,
  rows,
  onApprove,
  onReject,
  canApprove,
  emptyMessage,
}: ApprovalQueueProps) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const visible = filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-1.5 text-xs">
          <Button
            variant={filter === 'pending' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter('pending')}
          >
            Pending ({rows.filter((r) => r.status === 'pending').length})
          </Button>
          <Button
            variant={filter === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All ({rows.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {visible.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {emptyMessage ?? 'Nothing in this queue.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Requester</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Status</TableHead>
                {canApprove ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.requester}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{row.submittedAt}</TableCell>
                  <TableCell>{row.summary}</TableCell>
                  <TableCell>{row.detail}</TableCell>
                  <TableCell>
                    <StatusBadge tone={TONES[row.status]} label={row.status} />
                  </TableCell>
                  {canApprove ? (
                    <TableCell className="text-right">
                      {row.status === 'pending' ? (
                        <div className="inline-flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => onApprove?.(row.id)}>
                            <CheckIcon className="mr-1 size-3" aria-hidden />
                            Approve
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => onReject?.(row.id)}>
                            <XIcon className="mr-1 size-3" aria-hidden />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
