'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

type ClientOption = { id: string; name: string };

export type PaymentReceivedFormProps = {
  clients: readonly ClientOption[];
};

export function PaymentReceivedForm({ clients }: PaymentReceivedFormProps) {
  return (
    <SimpleTransactionForm
      kind="payment_received"
      title="Payment received"
      description="Posts to the chosen agency bank account ↔ 1200 Receivables (or 2180 Advances if no invoice yet)."
      requireSourceDocument
      showLineItems={false}
      fields={[
        {
          id: 'clientId',
          label: 'From client',
          type: 'select',
          required: true,
          options: clients.map((c) => ({ value: c.id, label: c.name })),
        },
        {
          id: 'bankAccountCode',
          label: 'Into bank',
          type: 'select',
          required: true,
          options: [
            { value: '1100', label: '1100 — HDFC Current' },
            { value: '1110', label: '1110 — ICICI Current' },
            { value: '1150', label: '1150 — Cash on hand' },
          ],
        },
        { id: 'paymentDate', label: 'Payment date', type: 'date', required: true },
        { id: 'paymentMode', label: 'Mode (NEFT/IMPS/UPI/Cash/Cheque)', type: 'text' },
        { id: 'utrNumber', label: 'UTR / reference', type: 'text' },
        { id: 'amount', label: 'Amount ₹', type: 'amount', required: true },
      ]}
      onCreateDraft={async ({ fieldValues, sourceDocumentId }) =>
        createDraftTransaction({
          kind: 'payment_received',
          clientId: fieldValues.clientId,
          sourceDocumentId,
          lines: [],
        })
      }
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
