'use client';

import { getDayBook } from '@/lib/server/ledger/report-suite';
import { ReportRangeView } from '@/components/reports/report-range-view';

export default function DayBookPage() {
  return (
    <ReportRangeView
      title="Day Book"
      subtitle="General journal — every posting in the range, in date order. Debits total to credits."
      exportName="day-book"
      sheetName="Day Book"
      columns={[
        { key: 'date', label: 'Date' },
        { key: 'particulars', label: 'Particulars' },
        { key: 'account', label: 'Account' },
        { key: 'debit', label: 'Debit', align: 'right', money: true },
        { key: 'credit', label: 'Credit', align: 'right', money: true },
      ]}
      fetchData={async (from, to) => {
        const d = await getDayBook({ from, to });
        return {
          note: d.truncated
            ? 'Showing the first 3,000 entries — narrow the date range.'
            : undefined,
          rows: d.rows.map((r) => ({
            date: r.txnDate.slice(0, 10),
            particulars: r.description ?? r.reference,
            account: `${r.accountCode} · ${r.accountName}`,
            debit: r.debitPaise || null,
            credit: r.creditPaise || null,
          })),
          totalRow: {
            date: '',
            particulars: 'Total',
            account: '',
            debit: d.totalDebitPaise,
            credit: d.totalCreditPaise,
          },
        };
      }}
    />
  );
}
