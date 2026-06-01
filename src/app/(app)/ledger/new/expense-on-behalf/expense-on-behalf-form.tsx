'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

type ClientOption = { id: string; name: string };
type VendorOption = { id: string; name: string };
type ProjectOption = { id: string; code: string; name: string };

export type ExpenseOnBehalfFormProps = {
  clients: readonly ClientOption[];
  vendors: readonly VendorOption[];
  projects: readonly ProjectOption[];
};

export function ExpenseOnBehalfForm({ clients, vendors, projects }: ExpenseOnBehalfFormProps) {
  return (
    <SimpleTransactionForm
      kind="expense_on_behalf"
      title="Expense on behalf of client"
      requireSourceDocument
      showLineItems
      showLineGst
      showLineHsn
      fields={[
        {
          id: 'clientId',
          label: 'For client',
          type: 'select',
          required: true,
          options: clients.map((c) => ({ value: c.id, label: c.name })),
        },
        {
          id: 'projectId',
          label: 'Project (optional)',
          type: 'select',
          options: projects.map((p) => ({
            value: p.id,
            label: `${p.code} — ${p.name}`,
          })),
        },
        {
          id: 'vendorId',
          label: 'Vendor (optional)',
          type: 'select',
          options: vendors.map((v) => ({ value: v.id, label: v.name })),
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
        {
          id: 'reimbursable',
          label: 'Will be reimbursed?',
          type: 'select',
          required: true,
          options: [
            { value: 'yes', label: 'Yes — bill to client separately' },
            { value: 'no', label: 'No — absorbed into project cost' },
          ],
        },
      ]}
      onCreateDraft={async ({ fieldValues, lines, sourceDocumentId }) =>
        createDraftTransaction({
          kind: 'expense_on_behalf',
          attribution: 'client',
          clientId: fieldValues.clientId,
          projectId: fieldValues.projectId || undefined,
          vendorId: fieldValues.vendorId || undefined,
          sourceDocumentId,
          lines: lines.map((l) => ({
            description: l.description,
            hsn: l.hsn,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
            gstPct: l.gstPct,
          })),
        })
      }
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
