import { describe, expect, it } from 'vitest';

import { renderRefundVoucherPdf, type RefundVoucherPdfData } from './refund-voucher';

const fixture: RefundVoucherPdfData = {
  supplier: {
    name: 'Apār LLP',
    address: 'Mumbai, MH 400013',
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    stateCode: '27',
  },
  recipient: {
    name: 'Lodha Group',
    addressLines: ['Lower Parel', 'Mumbai 400013'],
    gstin: '27LODHA1234A1Z3',
    stateCode: '27',
  },
  voucherNumber: 'REF/2025-26/0001',
  voucherDate: '2025-09-20',
  originalReceiptVoucherNumber: 'RV/2025-26/0001',
  originalReceiptVoucherDate: '2025-06-10',
  refundPaise: 5_00_000_00n,
  taxRefundPaise: 90_000_00n,
  reason: 'Campaign cancelled by client; balance refunded per service agreement clause 7.',
  isIntraState: true,
  notes: null,
};

describe('renderRefundVoucherPdf', () => {
  it('produces a valid PDF byte stream', async () => {
    const bytes = await renderRefundVoucherPdf(fixture);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  }, 20_000);

  it('renders a zero-tax refund without tax lines', async () => {
    const bytes = await renderRefundVoucherPdf({
      ...fixture,
      taxRefundPaise: 0n,
    });
    expect(bytes.byteLength).toBeGreaterThan(1024);
  }, 20_000);
});
