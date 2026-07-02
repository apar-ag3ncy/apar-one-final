'use client';

import { useEffect, useState } from 'react';

import {
  listAgencyBankAccounts,
  type AgencyBankAccountRow,
} from '@/lib/server/billing/agency-banks';
import { getBankBook } from '@/lib/server/ledger/statements';
import { getCombinedBankBook } from '@/lib/server/ledger/report-suite';
import { ReportRangeView, type ReportColumn } from '@/components/reports/report-range-view';

const COMBINED = 'combined';

export default function BankBookPage() {
  const [banks, setBanks] = useState<readonly AgencyBankAccountRow[]>([]);
  const [mode, setMode] = useState<string>(COMBINED);

  useEffect(() => {
    let off = false;
    listAgencyBankAccounts()
      .then((b) => !off && setBanks(b))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const combined = mode === COMBINED;
  const columns: ReportColumn[] = combined
    ? [
        { key: 'bank', label: 'Bank account' },
        { key: 'opening', label: 'Opening', align: 'right', money: true },
        { key: 'inflow', label: 'Money in', align: 'right', money: true },
        { key: 'outflow', label: 'Money out', align: 'right', money: true },
        { key: 'closing', label: 'Closing', align: 'right', money: true },
      ]
    : [
        { key: 'date', label: 'Date' },
        { key: 'particulars', label: 'Particulars' },
        { key: 'inflow', label: 'Money in', align: 'right', money: true },
        { key: 'outflow', label: 'Money out', align: 'right', money: true },
        { key: 'balance', label: 'Balance', align: 'right', money: true },
      ];

  return (
    <ReportRangeView
      title="Bank Book"
      subtitle={
        combined
          ? 'Every bank account: opening, movements, closing, with a grand total.'
          : 'One account: passbook with running balance.'
      }
      exportName={combined ? 'bank-book-all-accounts' : 'bank-book'}
      sheetName="Bank Book"
      columns={columns}
      signedCols={combined ? ['opening', 'closing'] : ['balance']}
      extraDeps={[mode]}
      extraControls={
        <div>
          <label className="text-muted-foreground block text-xs tracking-wide uppercase">
            Account
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value={COMBINED}>All accounts (combined)</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {b.bankName} ••{b.accountLast4}
                {b.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
      }
      fetchData={async (from, to) => {
        if (combined) {
          const d = await getCombinedBankBook({ from, to });
          return {
            rows: d.banks.map((b) => ({
              bank: `${b.label} · ${b.bankName} ••${b.accountLast4}${b.isActive ? '' : ' (inactive)'}`,
              opening: b.openingPaise,
              inflow: b.inflowPaise,
              outflow: b.outflowPaise,
              closing: b.closingPaise,
            })),
            totalRow: {
              bank: 'GRAND TOTAL',
              opening: d.grandOpeningPaise,
              inflow: d.grandInflowPaise,
              outflow: d.grandOutflowPaise,
              closing: d.grandClosingPaise,
            },
          };
        }
        const book = await getBankBook({ bankAccountId: mode, from, to });
        return {
          rows: [
            {
              date: '',
              particulars: `Brought forward (before ${from})`,
              inflow: null,
              outflow: null,
              balance: book.openingCarryPaise,
            },
            ...book.lines.map((l) => ({
              date: l.txnDate.slice(0, 10),
              particulars: l.documentNumber ?? l.description ?? l.reference,
              inflow: l.side === 'debit' ? l.amountPaise : null,
              outflow: l.side === 'credit' ? l.amountPaise : null,
              balance: l.runningBalancePaise,
            })),
          ],
          totalRow: {
            date: '',
            particulars: 'Closing balance',
            inflow: null,
            outflow: null,
            balance: book.closingBalancePaise,
          },
        };
      }}
    />
  );
}
