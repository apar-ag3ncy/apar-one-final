import 'server-only';

import { z } from 'zod';

import { AppError } from '@/lib/errors';

import type { PostingTemplateResult } from '../types';

/**
 * LEDGER-SPEC §3.7 — employee_reimbursement.
 *
 * Three shapes:
 *   - attribution='client', from bank   → Dr 5200 / Cr 1120
 *   - attribution='opex',   from bank   → Dr <6xxx>/ Cr 1120
 *   - settled against advance           → swap the Cr to 1230 (sub: employee)
 */
const opExCodes = ['6100', '6200', '6300', '6400', '6900'] as const;

export const EmployeeReimbursementInputSchema = z.discriminatedUnion('attribution', [
  z.object({
    attribution: z.literal('client'),
    employeeId: z.string().uuid(),
    onBehalfOfClientId: z.string().uuid(),
    projectId: z.string().uuid().optional(),
    amountPaise: z.bigint(),
    settlement: z.enum(['bank', 'advance']),
    bankAccountId: z.string().uuid().optional(),
    receiptDocumentId: z.string().uuid(),
    externalRef: z.string().min(1),
    txnDate: z.string(),
    notes: z.string().nullish(),
  }),
  z.object({
    attribution: z.literal('opex'),
    employeeId: z.string().uuid(),
    expenseAccountCode: z.enum(opExCodes),
    amountPaise: z.bigint(),
    settlement: z.enum(['bank', 'advance']),
    bankAccountId: z.string().uuid().optional(),
    receiptDocumentId: z.string().uuid(),
    externalRef: z.string().min(1),
    txnDate: z.string(),
    notes: z.string().nullish(),
  }),
]);

export type EmployeeReimbursementInput = z.infer<typeof EmployeeReimbursementInputSchema>;

export function employeeReimbursement(input: EmployeeReimbursementInput): PostingTemplateResult {
  const parsed = EmployeeReimbursementInputSchema.parse(input);
  if (parsed.settlement === 'bank' && !parsed.bankAccountId) {
    throw new AppError(
      'validation',
      'employee_reimbursement: bankAccountId required when settlement=bank',
    );
  }

  const debit =
    parsed.attribution === 'client'
      ? { accountCode: '5200' as const, metadata: { attribution: 'client' } }
      : { accountCode: parsed.expenseAccountCode, metadata: { attribution: 'opex' } };

  const credit =
    parsed.settlement === 'bank'
      ? {
          accountCode: '1120',
          subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId! },
        }
      : {
          accountCode: '1230',
          subledger: { entityType: 'employee' as const, entityId: parsed.employeeId },
        };

  return {
    externalRef: parsed.externalRef,
    description: `Employee reimbursement (${parsed.attribution})`,
    txnDate: parsed.txnDate,
    sourceKind: 'receipt',
    sourceDocumentId: parsed.receiptDocumentId,
    relatedEntityKind: 'employee',
    relatedEntityId: parsed.employeeId,
    onBehalfOfClientId: parsed.attribution === 'client' ? parsed.onBehalfOfClientId : undefined,
    incurredByEmployeeId: parsed.employeeId,
    projectId: parsed.attribution === 'client' ? parsed.projectId : undefined,
    notes: parsed.notes,
    postings: [
      { ...debit, side: 'debit', amountPaise: parsed.amountPaise },
      { ...credit, side: 'credit', amountPaise: parsed.amountPaise },
    ],
  };
}
