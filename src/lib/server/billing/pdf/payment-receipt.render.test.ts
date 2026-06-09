/**
 * Exercises @react-pdf/renderer for the payment-receipt voucher so a malformed
 * component tree or a future major bump is caught immediately. Light assertion:
 * %PDF- magic header + a minimum byte length.
 */
import { describe, expect, it } from 'vitest';

import { type PaymentReceiptPdfData, renderPaymentReceiptPdf } from './payment-receipt';

const fixture: PaymentReceiptPdfData = {
  supplier: {
    name: 'Apār LLP',
    address: 'Mumbai, MH 400013',
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    stateCode: '27',
  },
  recipient: {
    name: 'Bloom Realty',
    addressLines: ['Lower Parel', 'Mumbai 400013'],
    gstin: '27BLOOM1234A1Z3',
  },
  receiptNumber: 'RCT/2025-26/0001',
  receiptDate: '2025-06-15',
  amountPaise: 118_000_00n,
  method: 'bank_transfer',
  bankLabel: 'HDFC Current A/C',
  allocations: [{ documentNumber: 'INV/2025-26/0001', allocatedPaise: 118_000_00n }],
  unappliedPaise: 0n,
  notes: 'Thank you for your payment.',
};

describe('renderPaymentReceiptPdf', () => {
  it('produces a valid PDF byte stream', async () => {
    const bytes = await renderPaymentReceiptPdf(fixture);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  }, 20_000);

  it('renders an on-account receipt (no allocations, unapplied remainder)', async () => {
    const bytes = await renderPaymentReceiptPdf({
      ...fixture,
      allocations: [],
      unappliedPaise: 118_000_00n,
    });
    expect(bytes[0]).toBe(0x25);
    expect(bytes[3]).toBe(0x46);
  }, 20_000);
});
