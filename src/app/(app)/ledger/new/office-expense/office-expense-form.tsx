'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

const EXPENSE_ACCOUNTS = [
  { code: '6100', label: '6100 — Rent' },
  { code: '6200', label: '6200 — Utilities' },
  { code: '6400', label: '6400 — Software & SaaS' },
  { code: '6500', label: '6500 — Travel' },
  { code: '6600', label: '6600 — Office supplies' },
  { code: '6700', label: '6700 — Marketing' },
  { code: '6800', label: '6800 — Professional fees' },
];

export function OfficeExpenseForm() {
  return (
    <SimpleTransactionForm
      kind="office_expense"
      title="Office expense"
      requireSourceDocument
      showLineItems={false}
      fields={[
        {
          id: 'expenseAccount',
          label: 'Expense account',
          type: 'select',
          required: true,
          options: EXPENSE_ACCOUNTS.map((a) => ({ value: a.code, label: a.label })),
        },
        {
          id: 'paidFrom',
          label: 'Paid from',
          type: 'select',
          required: true,
          options: [
            { value: '1100', label: '1100 — HDFC Current' },
            { value: '1110', label: '1110 — ICICI Current' },
            { value: '1150', label: '1150 — Cash on hand' },
          ],
        },
        { id: 'expenseDate', label: 'Date', type: 'date', required: true },
        { id: 'amount', label: 'Amount ₹', type: 'amount', required: true },
        { id: 'gstClaimable', label: 'Input GST captured ₹', type: 'amount' },
        { id: 'narration', label: 'Narration', type: 'text' },
      ]}
      onCreateDraft={async ({ fieldValues, sourceDocumentId }) =>
        createDraftTransaction({
          kind: 'office_expense',
          attribution: 'opex',
          expenseAccountCode: fieldValues.expenseAccount,
          sourceDocumentId,
          lines: [],
        })
      }
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
