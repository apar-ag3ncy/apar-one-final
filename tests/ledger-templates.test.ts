import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { sumPaise } from '@/lib/money';
import { clientInvoice } from '@/lib/server/ledger/postings/clientInvoice';
import { vendorBill } from '@/lib/server/ledger/postings/vendorBill';
import { journal } from '@/lib/server/ledger/postings/journal';

/**
 * Property tests for the posting templates.
 *
 *   - The Phase 5 brief calls for property tests on:
 *       balances sum to zero, debits = credits, control = sum sub-ledger,
 *       reversal restores balances, idempotency on external_ref.
 *
 *   - These tests run on the *template* output (pure functions). The
 *     database-side balanced trigger is the second-level guard; running
 *     it requires a Postgres instance which is out of scope for unit
 *     tests.
 *
 *   - fast-check generators stay small to keep CI quick. Bigint amounts
 *     ≤ 10¹² paise (~₹100 Cr).
 */

const paiseArb = fc
  .bigInt({ min: 1n, max: 10n ** 12n })
  .filter((n) => n > 0n);

const uuidArb = fc
  .uuid()
  .map((s) => s as string);

const isoDateArb = fc
  .date({ min: new Date('2025-04-01'), max: new Date('2027-03-31') })
  .map((d) => d.toISOString().slice(0, 10));

function sumSide(result: ReturnType<typeof clientInvoice>, side: 'debit' | 'credit'): bigint {
  return sumPaise(result.postings.filter((p) => p.side === side).map((p) => p.amountPaise));
}

describe('clientInvoice template', () => {
  it('debits = credits for random valid invoices', () => {
    fc.assert(
      fc.property(
        uuidArb,
        uuidArb,
        isoDateArb,
        fc.array(
          fc.record({
            description: fc.string({ minLength: 1, maxLength: 20 }),
            amountPaise: paiseArb,
            gstAmountPaiseCaptured: fc.bigInt({ min: 0n, max: 10n ** 11n }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (clientId, invoiceDocId, txnDate, lineItems) => {
          const r = clientInvoice({
            clientId,
            invoiceDocumentId: invoiceDocId,
            invoiceNumber: `INV-${Math.floor(Math.random() * 100000)}`,
            txnDate,
            lineItems,
          });
          expect(sumSide(r, 'debit')).toBe(sumSide(r, 'credit'));
          expect(r.postings.length).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('vendorBill template', () => {
  it('attribution=client posts to 5100 and tags on_behalf_of_client_id', () => {
    const r = vendorBill({
      attribution: 'client',
      vendorId: '00000000-0000-4000-8000-000000000001',
      onBehalfOfClientId: '00000000-0000-4000-8000-000000000002',
      billDocumentId: '00000000-0000-4000-8000-000000000003',
      vendorInvoiceNumber: 'VB-001',
      txnDate: '2026-04-15',
      lineItems: [{ description: 'photographer', amountPaise: 3000000n, gstAmountPaiseCaptured: 540000n }],
      tdsAmountPaise: 60000n,
      tdsSection: '194C',
      isRcm: false,
    });
    expect(r.onBehalfOfClientId).toBe('00000000-0000-4000-8000-000000000002');
    const dr5100 = r.postings.find((p) => p.accountCode === '5100' && p.side === 'debit');
    expect(dr5100).toBeDefined();
    expect(dr5100?.amountPaise).toBe(3000000n);
    expect(sumSide(r as unknown as ReturnType<typeof clientInvoice>, 'debit')).toBe(
      sumSide(r as unknown as ReturnType<typeof clientInvoice>, 'credit'),
    );
  });

  it('attribution=opex posts to the chosen expense account', () => {
    const r = vendorBill({
      attribution: 'opex',
      vendorId: '00000000-0000-4000-8000-000000000001',
      expenseAccountCode: '6300',
      billDocumentId: '00000000-0000-4000-8000-000000000003',
      vendorInvoiceNumber: 'VB-002',
      txnDate: '2026-04-15',
      lineItems: [{ description: 'figma seat', amountPaise: 50000n, gstAmountPaiseCaptured: 9000n }],
      tdsAmountPaise: 0n,
      isRcm: false,
    });
    expect(r.onBehalfOfClientId).toBeUndefined();
    expect(r.postings.some((p) => p.accountCode === '6300' && p.side === 'debit')).toBe(true);
  });

  it('attribution=asset posts to 1510 and has NO TDS', () => {
    const r = vendorBill({
      attribution: 'asset',
      vendorId: '00000000-0000-4000-8000-000000000001',
      billDocumentId: '00000000-0000-4000-8000-000000000003',
      vendorInvoiceNumber: 'VB-003',
      txnDate: '2026-04-15',
      lineItems: [{ description: 'laptop', amountPaise: 8000000n, gstAmountPaiseCaptured: 1440000n }],
      isRcm: false,
    });
    expect(r.postings.some((p) => p.accountCode === '1510' && p.side === 'debit')).toBe(true);
    expect(r.postings.some((p) => p.accountCode === '2130')).toBe(false);
  });
});

describe('journal template', () => {
  it('rejects unbalanced legs', () => {
    expect(() =>
      journal({
        externalRef: 'OPEN-001',
        txnDate: '2026-04-01',
        journalReason: 'opening balance test',
        legs: [
          { accountCode: '1120', side: 'debit', amountPaise: 100n, subledger: { entityType: 'office', entityId: '00000000-0000-4000-8000-000000000001' } },
          { accountCode: '3100', side: 'credit', amountPaise: 200n, subledger: { entityType: 'office', entityId: '00000000-0000-4000-8000-000000000002' } },
        ],
        isOpeningBalance: true,
      }),
    ).toThrow(/unbalanced/);
  });

  it('accepts balanced legs and marks opening_balance source_kind', () => {
    const r = journal({
      externalRef: 'OPEN-001',
      txnDate: '2026-04-01',
      journalReason: 'opening balance test',
      legs: [
        { accountCode: '1120', side: 'debit', amountPaise: 1000000n, subledger: { entityType: 'office', entityId: '00000000-0000-4000-8000-000000000001' } },
        { accountCode: '3100', side: 'credit', amountPaise: 1000000n, subledger: { entityType: 'office', entityId: '00000000-0000-4000-8000-000000000002' } },
      ],
      isOpeningBalance: true,
    });
    expect(r.sourceKind).toBe('opening_balance');
    expect(r.postings).toHaveLength(2);
  });
});
