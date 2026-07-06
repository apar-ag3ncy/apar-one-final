import 'server-only';

import { z } from 'zod';

import type { PostingTemplateResult } from '../types';

/**
 * SPEC-AMENDMENT-001 §9.2 — salary_disbursement (paid directly, no payable
 * accrual step). One employee per transaction so the per-employee book reads
 * straight off the transaction header.
 *
 *   Dr  6100 Salaries & Wages      amount
 *      Cr  1110 Cash on Hand | 1120 Bank (sub: bank_id)   amount
 *
 * The cash leg follows how the salary was actually paid: `mode: 'cash'`
 * credits 1110; `mode: 'bank'` credits 1120 sub-ledgered to the agency bank
 * account (same 'office' placeholder convention as clientPaymentReceived /
 * vendorPaymentMade). Defaults to 'cash' for back-compat with legacy callers.
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
  /** 'bank' → Cr 1120 (needs bankAccountId); 'cash' → Cr 1110. */
  mode: z.enum(['bank', 'cash']).default('cash'),
  bankAccountId: z.string().uuid().nullish(),
  txnDate: z.string(),
  externalRef: z.string().min(1),
  notes: z.string().nullish(),
});

export type SalaryDisbursementInput = z.input<typeof SalaryDisbursementInputSchema>;

export function salaryDisbursement(input: SalaryDisbursementInput): PostingTemplateResult {
  const parsed = SalaryDisbursementInputSchema.parse(input);
  const payFromBank = parsed.mode === 'bank' && !!parsed.bankAccountId;
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
      {
        accountCode: payFromBank ? '1120' : '1110',
        side: 'credit',
        amountPaise: parsed.amountPaise,
        // 1120 is a control account sub-ledgered by bank_accounts.id
        // (entityType 'office' is the placeholder the trigger expects).
        ...(payFromBank
          ? { subledger: { entityType: 'office' as const, entityId: parsed.bankAccountId! } }
          : {}),
        metadata: { mode: payFromBank ? 'bank' : 'cash' },
      },
    ],
  };
}
