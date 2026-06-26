import { describe, expect, it } from 'vitest';

import { salaryDisbursement } from './salaryDisbursement';

const base = {
  employeeId: '11111111-1111-4111-8111-111111111111',
  amountPaise: 6_000_000n, // ₹60,000.00
  txnDate: '2026-06-25',
  externalRef: 'SAL-2026-06-25-11111111-123',
  notes: 'June salary',
};

describe('salaryDisbursement template', () => {
  it('produces a balanced Dr 6100 / Cr 1110 entry', () => {
    const r = salaryDisbursement(base);
    expect(r.postings).toHaveLength(2);

    const debit = r.postings.find((p) => p.side === 'debit')!;
    const credit = r.postings.find((p) => p.side === 'credit')!;
    expect(debit.accountCode).toBe('6100'); // Salaries & Wages
    expect(credit.accountCode).toBe('1110'); // Cash on Hand
    expect(debit.amountPaise).toBe(base.amountPaise);
    expect(credit.amountPaise).toBe(base.amountPaise);

    const totalDebit = r.postings
      .filter((p) => p.side === 'debit')
      .reduce((a, p) => a + p.amountPaise, 0n);
    const totalCredit = r.postings
      .filter((p) => p.side === 'credit')
      .reduce((a, p) => a + p.amountPaise, 0n);
    expect(totalDebit).toBe(totalCredit);
  });

  it('attributes the employee on the header, not a posting sub-ledger', () => {
    const r = salaryDisbursement(base);
    expect(r.relatedEntityKind).toBe('employee');
    expect(r.relatedEntityId).toBe(base.employeeId);
    expect(r.incurredByEmployeeId).toBe(base.employeeId);
    // 6100/1110 are non-control — sub-ledger on them is forbidden by trigger.
    for (const p of r.postings) expect(p.subledger).toBeUndefined();
  });

  it('carries no source document (exempt kind) and passes through notes/date/ref', () => {
    const r = salaryDisbursement(base);
    expect(r.sourceDocumentId).toBeUndefined();
    expect(r.sourceKind).toBe('payment');
    expect(r.txnDate).toBe(base.txnDate);
    expect(r.externalRef).toBe(base.externalRef);
    expect(r.notes).toBe('June salary');
  });

  it('rejects a non-positive amount', () => {
    expect(() => salaryDisbursement({ ...base, amountPaise: 0n })).toThrow();
    expect(() => salaryDisbursement({ ...base, amountPaise: -100n })).toThrow();
  });
});
