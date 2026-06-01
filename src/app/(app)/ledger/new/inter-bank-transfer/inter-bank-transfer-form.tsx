'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

const BANK_ACCOUNTS = [
  { value: '1100', label: '1100 — HDFC Current' },
  { value: '1110', label: '1110 — ICICI Current' },
  { value: '1150', label: '1150 — Cash on hand' },
];

export function InterBankTransferForm() {
  return (
    <SimpleTransactionForm
      kind="inter_bank_transfer"
      title="Transfer details"
      showLineItems={false}
      requireSourceDocument={false}
      fields={[
        {
          id: 'fromAccount',
          label: 'From',
          type: 'select',
          required: true,
          options: BANK_ACCOUNTS,
        },
        { id: 'toAccount', label: 'To', type: 'select', required: true, options: BANK_ACCOUNTS },
        { id: 'transferDate', label: 'Date', type: 'date', required: true },
        { id: 'amount', label: 'Amount ₹', type: 'amount', required: true },
        { id: 'utrNumber', label: 'UTR / reference', type: 'text' },
      ]}
      onCreateDraft={async () => createDraftTransaction({ kind: 'inter_bank_transfer', lines: [] })}
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
