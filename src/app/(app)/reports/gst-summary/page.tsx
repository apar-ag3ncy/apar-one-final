'use client';

import { getGstSummary } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
}

export default function GstSummaryPage() {
  return (
    <ReportRangeView
      title="GST Summary"
      subtitle="Output GST (2120) vs input credit (1250), by month. Positive net = GST owed to the department."
      exportName="gst-summary"
      sheetName="GST Summary"
      signedCols={['net']}
      columns={[
        { key: 'month', label: 'Month' },
        { key: 'output', label: 'Output GST', align: 'right', money: true },
        { key: 'input', label: 'Input GST', align: 'right', money: true },
        { key: 'net', label: 'Net payable', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getGstSummary({ from, to });
        return {
          rows: d.rows.map((r) => ({
            month: monthLabel(r.month),
            output: r.outputPaise,
            input: r.inputPaise,
            net: r.netPayablePaise,
          })),
          totalRow: {
            month: 'TOTAL',
            output: d.totalOutputPaise,
            input: d.totalInputPaise,
            net: d.netPayablePaise,
          },
        };
      }}
    />
  );
}
