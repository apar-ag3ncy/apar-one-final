'use client';

import { getTdsSummary } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

export default function TdsSummaryPage() {
  return (
    <ReportRangeView
      title="TDS Summary"
      subtitle="TDS receivable (1260, withheld by clients) vs TDS payable (2130, withheld by us), by month."
      exportName="tds-summary"
      sheetName="TDS Summary"
      columns={[
        { key: 'month', label: 'Month' },
        { key: 'receivable', label: 'TDS receivable', align: 'right', money: true },
        { key: 'payable', label: 'TDS payable', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getTdsSummary({ from, to });
        return {
          rows: d.rows.map((r) => ({
            month: monthLabel(r.month),
            receivable: r.receivablePaise,
            payable: r.payablePaise,
          })),
          totalRow: {
            month: 'TOTAL',
            receivable: d.totalReceivablePaise,
            payable: d.totalPayablePaise,
          },
        };
      }}
    />
  );
}
