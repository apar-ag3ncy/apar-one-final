'use client';

import { getProjectPnlAll } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

export default function ProjectPnlPage() {
  return (
    <ReportRangeView
      title="Per-Project P&L"
      subtitle="Revenue billed & received from the client vs vendor cost billed & paid, per project."
      exportName="project-pnl"
      sheetName="Per-Project P&L"
      signedCols={['margin']}
      columns={[
        { key: 'project', label: 'Project' },
        { key: 'client', label: 'Client' },
        { key: 'billed', label: 'Billed', align: 'right', money: true },
        { key: 'received', label: 'Received', align: 'right', money: true },
        { key: 'cost', label: 'Vendor cost', align: 'right', money: true },
        { key: 'paid', label: 'Paid', align: 'right', money: true },
        { key: 'margin', label: 'Margin', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getProjectPnlAll({ from, to });
        return {
          rows: d.rows.map((r) => ({
            project: r.projectName,
            client: r.clientName ?? '—',
            billed: r.billedPaise,
            received: r.receivedPaise,
            cost: r.costedPaise,
            paid: r.paidPaise,
            margin: r.marginPaise,
          })),
          totalRow: {
            project: 'TOTAL',
            client: '',
            billed: d.totalBilledPaise,
            received: d.totalReceivedPaise,
            cost: d.totalCostedPaise,
            paid: d.totalPaidPaise,
            margin: d.totalMarginPaise,
          },
        };
      }}
    />
  );
}
