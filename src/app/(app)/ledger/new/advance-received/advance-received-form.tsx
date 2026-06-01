'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

type ClientOption = { id: string; name: string };

export type AdvanceReceivedFormProps = {
  clients: readonly ClientOption[];
};

export function AdvanceReceivedForm({ clients }: AdvanceReceivedFormProps) {
  return (
    <SimpleTransactionForm
      kind="advance_received"
      title="Advance details"
      requireSourceDocument
      showLineItems={false}
      fields={[
        {
          id: 'clientId',
          label: 'Client',
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
          ],
        },
        { id: 'receivedDate', label: 'Received date', type: 'date', required: true },
        { id: 'amount', label: 'Amount ₹', type: 'amount', required: true },
        { id: 'gstApplicable', label: 'GST captured', type: 'amount' },
        { id: 'expectedInvoiceMonth', label: 'Expected invoice month', type: 'text' },
      ]}
      onCreateDraft={async ({ fieldValues, sourceDocumentId }) =>
        createDraftTransaction({
          kind: 'advance_received',
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
