'use client';

import { SimpleTransactionForm } from '@/components/entity/simple-transaction-form';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';

type VendorOption = { id: string; name: string };
type EmployeeOption = { id: string; name: string };

export type PaymentMadeFormProps = {
  vendors: readonly VendorOption[];
  employees: readonly EmployeeOption[];
};

export function PaymentMadeForm({ vendors, employees }: PaymentMadeFormProps) {
  const options = [
    ...vendors.map((v) => ({ value: `vendor:${v.id}`, label: `Vendor — ${v.name}` })),
    ...employees.map((e) => ({
      value: `employee:${e.id}`,
      label: `Employee — ${e.name}`,
    })),
  ];
  return (
    <SimpleTransactionForm
      kind="payment_made"
      title="Payment details"
      description="Posts to 2100 Payables (vendor) or 6300 Salaries / reimbursement clearing (employee), debit; bank credit."
      requireSourceDocument
      showLineItems={false}
      fields={[
        {
          id: 'counterparty',
          label: 'Pay to',
          type: 'select',
          required: true,
          options,
        },
        {
          id: 'bankAccountCode',
          label: 'From bank',
          type: 'select',
          required: true,
          options: [
            { value: '1100', label: '1100 — HDFC Current' },
            { value: '1110', label: '1110 — ICICI Current' },
            { value: '1150', label: '1150 — Cash on hand' },
          ],
        },
        { id: 'paymentDate', label: 'Payment date', type: 'date', required: true },
        { id: 'paymentMode', label: 'Mode', type: 'text' },
        { id: 'utrNumber', label: 'UTR / reference', type: 'text' },
        { id: 'amount', label: 'Amount ₹', type: 'amount', required: true },
      ]}
      onCreateDraft={async ({ fieldValues, sourceDocumentId }) => {
        const [kind, id] = (fieldValues.counterparty ?? '').split(':');
        return createDraftTransaction({
          kind: 'payment_made',
          vendorId: kind === 'vendor' ? id : undefined,
          sourceDocumentId,
          lines: [],
        });
      }}
      onPost={postTransaction}
      onSuccessHref="/ledger"
    />
  );
}
