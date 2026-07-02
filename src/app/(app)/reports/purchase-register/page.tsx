'use client';

import { getPurchaseRegister } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

export default function PurchaseRegisterPage() {
  return (
    <ReportRangeView
      title="Purchase Register"
      subtitle="Every vendor bill recorded in the range — taxable value, GST, total."
      exportName="purchase-register"
      sheetName="Purchase Register"
      columns={[
        { key: 'date', label: 'Date' },
        { key: 'doc', label: 'Bill no.' },
        { key: 'party', label: 'Vendor' },
        { key: 'project', label: 'Project' },
        { key: 'taxable', label: 'Taxable', align: 'right', money: true },
        { key: 'gst', label: 'GST', align: 'right', money: true },
        { key: 'total', label: 'Total', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getPurchaseRegister({ from, to });
        return {
          rows: d.rows.map((r) => ({
            date: r.txnDate.slice(0, 10),
            doc: r.documentNumber,
            party: r.partyName ?? '—',
            project: r.projectName ?? '—',
            taxable: r.taxablePaise,
            gst: r.gstPaise,
            total: r.totalPaise,
          })),
          totalRow: {
            date: '',
            doc: 'TOTAL',
            party: '',
            project: '',
            taxable: d.totalTaxablePaise,
            gst: d.totalGstPaise,
            total: d.totalPaise,
          },
        };
      }}
    />
  );
}
