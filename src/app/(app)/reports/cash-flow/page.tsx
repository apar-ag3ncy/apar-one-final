'use client';

import { getCashFlowStatement } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

function kindLabel(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CashFlowPage() {
  return (
    <ReportRangeView
      title="Cash Flow"
      subtitle="Direct method — cash + bank (1110 + 1120) movement by category, opening to closing."
      exportName="cash-flow"
      sheetName="Cash Flow"
      signedCols={['net']}
      columns={[
        { key: 'category', label: 'Category' },
        { key: 'inflow', label: 'Money in', align: 'right', money: true },
        { key: 'outflow', label: 'Money out', align: 'right', money: true },
        { key: 'net', label: 'Net', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getCashFlowStatement({ from, to });
        return {
          rows: [
            { category: 'Opening cash & bank', inflow: null, outflow: null, net: d.openingPaise },
            ...d.rows.map((r) => ({
              category: kindLabel(r.kind),
              inflow: r.inflowPaise || null,
              outflow: r.outflowPaise || null,
              net: r.netPaise,
            })),
          ],
          totalRow: {
            category: 'Closing cash & bank',
            inflow: d.totalInflowPaise,
            outflow: d.totalOutflowPaise,
            net: d.closingPaise,
          },
        };
      }}
    />
  );
}
