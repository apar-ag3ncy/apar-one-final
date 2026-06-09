'use client';

import { ApprovalQueue, type ApprovalRow } from '@/components/entity/approval-queue';

type Row = {
  id: string;
  requester: string;
  submittedAt: string;
  summary: string;
  from: string;
  to: string;
  days: number;
  status: 'pending' | 'approved' | 'rejected';
};

export function LeavesClient({ rows }: { rows: readonly Row[] }) {
  const adapted: ApprovalRow[] = rows.map((r) => ({
    id: r.id,
    requester: r.requester,
    submittedAt: r.submittedAt,
    summary: r.summary,
    detail: (
      <div className="text-sm">
        <div>
          {r.from} → {r.to}
        </div>
        <div className="text-muted-foreground text-xs">
          {r.days} day{r.days === 1 ? '' : 's'}
        </div>
      </div>
    ),
    status: r.status,
  }));
  // Read-only preview: approve/reject is wired once the leave queue is served
  // from the DB (no real row ids to act on yet), so we don't render no-op
  // approve/reject buttons.
  return <ApprovalQueue title="Leave applications" rows={adapted} />;
}
