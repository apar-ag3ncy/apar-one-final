import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * SPEC-AMENDMENT-001 §9.2 — salary_disbursement (paid directly, no payable
 * accrual step). One employee per transaction so the per-employee book reads
 * straight off the transaction header.
 *
 *   Dr  6100 Salaries & Wages      amount
 *      Cr  1110 Cash on Hand          amount
 *
 * The employee is attributed via `related_entity` + `incurred_by_employee_id`
 * on the header (NOT a posting sub-ledger — 6100/1110 are non-control accounts,
 * and the control-discipline trigger forbids sub-ledger on non-control). There
 * is no source document: the `transactions_source_document_required` CHECK
 * exempts this kind (see 0046_salary_payments_ledger.sql).
 */
export const SalaryDisbursementInputSchema = z.object({
  employeeId: z.string().uuid(),
  amountPaise: z.bigint().positive(),
  txnDate: z.string(),
  externalRef: z.string().min(1),
  notes: z.string().nullish(),
});

export type SalaryDisbursementInput = z.infer<typeof SalaryDisbursementInputSchema>;

export function salaryDisbursement(input: SalaryDisbursementInput): PostingTemplateResult {
  const parsed = SalaryDisbursementInputSchema.parse(input);
  return {
    externalRef: parsed.externalRef,
    description: 'Salary paid',
    txnDate: parsed.txnDate,
    sourceKind: 'payment',
    relatedEntityKind: 'employee',
    relatedEntityId: parsed.employeeId,
    incurredByEmployeeId: parsed.employeeId,
    notes: parsed.notes,
    postings: [
      { accountCode: '6100', side: 'debit', amountPaise: parsed.amountPaise },
      { accountCode: '1110', side: 'credit', amountPaise: parsed.amountPaise },
    ],
  };
}
