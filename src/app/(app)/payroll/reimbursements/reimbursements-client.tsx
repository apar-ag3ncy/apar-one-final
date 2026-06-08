'use client';

import { ApprovalQueue, type ApprovalRow } from '@/components/entity/approval-queue';
import { formatINR } from '@/components/shared/format-inr';

type Row = {
  id: string;
  requester: string;
  submittedAt: string;
  summary: string;
  amountPaise: bigint;
  receiptCount: number;
  status: 'pending' | 'approved' | 'rejected';
};

export function ReimbursementsClient({ rows }: { rows: readonly Row[] }) {
  const adapted: ApprovalRow[] = rows.map((r) => ({
    id: r.id,
    requester: r.requester,
    submittedAt: r.submittedAt,
    summary: r.summary,
    detail: (
      <div className="text-sm">
        <div className="font-mono tabular-nums">{formatINR(r.amountPaise)}</div>
        <div className="text-muted-foreground text-xs">
          {r.receiptCount} receipt{r.receiptCount === 1 ? '' : 's'}
        </div>
      </div>
    ),
    status: r.status,
  }));
  // Read-only preview until the reimbursement queue is served from the DB
  // (approveReimbursement/rejectReimbursement need real row ids) — so no
  // no-op approve/reject buttons are shown.
  return <ApprovalQueue title="Reimbursements" rows={adapted} />;
}
