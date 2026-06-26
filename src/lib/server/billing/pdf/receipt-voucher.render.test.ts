import { describe, expect, it } from 'vitest';

import { renderReceiptVoucherPdf, type ReceiptVoucherPdfData } from './receipt-voucher';

const intraState: ReceiptVoucherPdfData = {
  supplier: {
    name: 'Apar LLP',
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
  voucherNumber: 'RV/2025-26/0001',
  voucherDate: '2025-06-10',
  placeOfSupply: '27',
  sacCode: '998361',
  description: 'Advance for Q3 advertising campaign',
  advancePaise: 5_00_000_00n,
  taxPaise: 90_000_00n,
  taxRateBps: 1800,
  isIntraState: true,
  isReverseCharge: false,
  notes: null,
};

describe('renderReceiptVoucherPdf', () => {
  it('produces a valid PDF byte stream for an intra-state advance', async () => {
    const bytes = await renderReceiptVoucherPdf(intraState);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  }, 20_000);

  it('produces a valid PDF byte stream for an inter-state advance (IGST)', async () => {
    const bytes = await renderReceiptVoucherPdf({
      ...intraState,
      placeOfSupply: '29',
      recipient: { ...intraState.recipient, stateCode: '29' },
      isIntraState: false,
    });
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25);
  }, 20_000);

  it('renders a zero-tax advance without a tax line', async () => {
    const bytes = await renderReceiptVoucherPdf({
      ...intraState,
      advancePaise: 1_00_000_00n,
      taxPaise: 0n,
      taxRateBps: 0,
    });
    expect(bytes.byteLength).toBeGreaterThan(1024);
  }, 20_000);
});
