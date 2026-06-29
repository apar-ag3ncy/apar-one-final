/**
 * Integration-shape test: actually exercises @react-pdf/renderer's
 * renderToBuffer with a small fixture so a malformed component tree
 * or a future major bump that breaks our usage gets caught immediately.
 *
 * Light assertion only — we check the PDF magic header (%PDF-) and a
 * minimum byte length. The visual layout is verified by eye when the
 * dashboard renders an invoice.
 */
import { describe, expect, it } from 'vitest';

import { type InvoicePdfData, renderInvoicePdf } from './invoice';

const fixture: InvoicePdfData = {
  supplier: {
    name: 'Apar LLP',
    address: 'Mumbai, MH 400013',
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
    pan: 'LODHA1234A',
    stateCode: '27',
    contactEmail: 'accounts@lodha.com',
  },
  documentNumber: 'INV/2025-26/0001',
  documentDate: '2025-06-15',
  dueDate: '2025-07-15',
  placeOfSupply: '27',
  isReverseCharge: false,
  lines: [
    {
      lineNo: 1,
      description: 'Brand identity refresh',
      sacCode: '998391',
      unit: null,
      qty: 1,
      ratePaise: 100_000_00n,
      capturedTaxableValuePaise: 100_000_00n,
      capturedTaxRateBps: 1800,
      capturedTaxAmountPaise: 18_000_00n,
    },
  ],
  subtotalPaise: 100_000_00n,
  capturedTaxSplit: {
    cgstPaise: 9_000_00n,
    sgstPaise: 9_000_00n,
    igstPaise: 0n,
    cessPaise: 0n,
  },
  capturedTaxTotalPaise: 18_000_00n,
  capturedTotalPaise: 118_000_00n,
  payment: {
    beneficiaryName: 'Apar LLP',
    bankName: 'HDFC Bank',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0000123',
    branchName: 'Lower Parel, Mumbai',
  },
  paymentLink: null,
  terms: 'Net 30',
  notes: 'Thank you for your business.',
};

describe('renderInvoicePdf', () => {
  it('produces a valid PDF byte stream', async () => {
    const bytes = await renderInvoicePdf(fixture);
    expect(bytes.byteLength).toBeGreaterThan(1024); // a non-trivial doc
    // %PDF- magic header (4 ASCII bytes: %, P, D, F)
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x44);
    expect(bytes[3]).toBe(0x46);
  }, 20_000); // @react-pdf/renderer first-call cold start is slow

  it('renders a themed invoice (brand colours + serif font + custom header) to a valid PDF', async () => {
    const themed: InvoicePdfData = {
      ...fixture,
      themeOverrides: {
        primaryColor: '#1f6b3b',
        secondaryColor: '#0f3a20',
        accentColor: '#a4d8b3',
        fontFamily: 'Times-Roman',
        headerText: 'TAX INVOICE',
        footerText: 'Computer-generated; no signature required.',
        // 1×1 transparent PNG data-URI — exercises the <Image> logo path.
        logoDataUri:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    };
    const bytes = await renderInvoicePdf(themed);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  }, 20_000);

  it('renders with bold style tokens + a rearranged layout to a valid PDF', async () => {
    const styled: InvoicePdfData = {
      ...fixture,
      themeOverrides: { primaryColor: '#1f6b3b', accentColor: '#a4d8b3' },
      style: {
        fontScale: 1.25,
        density: 'relaxed',
        logoSize: 'lg',
        logoAlign: 'center',
        accentHeaderBand: true,
        emphasizeTotal: true,
        colorHeadings: true,
        columns: { srNo: true, hsn: true, qtyRate: true, taxPct: true },
        colors: {
          tableHeaderBg: '#0B5E3B',
          tableHeaderText: '#FFFFFF',
          totalBg: '#0B5E3B',
          totalText: '#FFFFFF',
          heading: '#0B5E3B',
          title: '#0B5E3B',
        },
        margins: { top: 22, right: 18, bottom: 24, left: 18 },
      },
      layout: {
        version: 1,
        header: { left: ['logo', 'supplier'], right: ['meta', 'billTo'] },
        aboveTable: [],
        belowTable: ['amountWords', 'payment', 'terms', 'notes', 'signatory', 'paymentLink'],
        hidden: [],
      },
    };
    const bytes = await renderInvoicePdf(styled);
    expect(bytes.byteLength).toBeGreaterThan(1024);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[3]).toBe(0x46); // F
  }, 20_000);

  it('clamps a non-built-in font to a safe family instead of throwing', async () => {
    const themed: InvoicePdfData = {
      ...fixture,
      themeOverrides: { fontFamily: 'Calibri Light' },
    };
    const bytes = await renderInvoicePdf(themed);
    expect(bytes[0]).toBe(0x25);
    expect(bytes[3]).toBe(0x46);
  }, 20_000);
});
