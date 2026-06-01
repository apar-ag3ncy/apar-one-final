import { describe, expect, it } from 'vitest';

import { totalsRowsFor, type InvoicePdfData } from './invoice';

function sample(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    supplier: {
      name: 'Apār LLP',
      address: 'Mumbai, MH',
      gstin: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      stateCode: '27',
      contactEmail: 'hello@apar.com',
      contactPhone: '+91 22 1234 5678',
      logoBucket: null,
      logoStoragePath: null,
    },
    recipient: {
      name: 'Lodha Group',
      addressLines: ['Lower Parel', 'Mumbai 400013'],
      gstin: '27LODHA1234A1Z3',
      stateCode: '27',
      contactEmail: 'accounts@lodha.com',
    },
    documentNumber: 'INV/2025-26/0001',
    documentDate: '2025-06-15',
    dueDate: '2025-07-15',
    placeOfSupply: '27',
    isReverseCharge: false,
    lines: [],
    subtotalPaise: 100_000_00n,
    capturedTaxSplit: {
      cgstPaise: 9_000_00n,
      sgstPaise: 9_000_00n,
      igstPaise: 0n,
      cessPaise: 0n,
    },
    capturedTaxTotalPaise: 18_000_00n,
    capturedTotalPaise: 118_000_00n,
    paymentLink: null,
    terms: null,
    notes: null,
    ...overrides,
  };
}

describe('totalsRowsFor', () => {
  it('emits only the tax components with positive amounts', () => {
    const rows = totalsRowsFor(sample());
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(['Subtotal', 'CGST', 'SGST', 'Total tax', 'Grand total']);
  });

  it('emits IGST instead of CGST/SGST for inter-state invoices', () => {
    const rows = totalsRowsFor(
      sample({
        capturedTaxSplit: {
          cgstPaise: 0n,
          sgstPaise: 0n,
          igstPaise: 18_000_00n,
          cessPaise: 0n,
        },
      }),
    );
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(['Subtotal', 'IGST', 'Total tax', 'Grand total']);
  });

  it('preserves paise precision (bigint comparison)', () => {
    const rows = totalsRowsFor(sample());
    expect(rows.find((r) => r.label === 'Grand total')?.valuePaise).toBe(118_000_00n);
  });
});
