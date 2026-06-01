'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

type SelectOption = { value: string; label: string };

export type ClientInvoiceFormProps = {
  clientOptions: readonly SelectOption[];
  projectOptions: readonly SelectOption[];
};

export function ClientInvoiceForm({ clientOptions, projectOptions }: ClientInvoiceFormProps) {
  return (
    <SimpleTransactionForm
      kind="client_invoice"
      title="Client invoice details"
      requireSourceDocument
      showLineItems
      showLineGst
      showLineHsn
      fields={[
        {
          id: 'clientId',
          label: 'Client',
          type: 'select',
          required: true,
          options: clientOptions,
        },
        {
          id: 'projectId',
          label: 'Project (optional)',
          type: 'select',
          options: projectOptions,
        },
        { id: 'invoiceNumber', label: 'Invoice number', type: 'text', required: true },
        { id: 'invoiceDate', label: 'Invoice date', type: 'date', required: true },
        { id: 'placeOfSupply', label: 'Place of supply', type: 'text' },
        { id: 'dueDate', label: 'Due date', type: 'date' },
      ]}
      onCreateDraft={async ({ fieldValues, lines, sourceDocumentId, memo: _memo }) => {
        const r = await createDraftTransaction({
          kind: 'client_invoice',
          clientId: fieldValues.clientId,
          projectId: fieldValues.projectId || undefined,
          sourceDocumentId,
          lines: lines.map((l) => ({
            description: l.description,
            hsn: l.hsn,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
            gstPct: l.gstPct,
          })),
        });
        return r;
      }}
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
