import { describe, expect, it } from 'vitest';

import {
  AMOUNT_COL_WIDTH,
  DEFAULT_INVOICE_STYLE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  invoiceTableColumns,
  metricsFor,
  readableTextOn,
  sanitizeInvoiceStyle,
} from './invoice-style';

const withCols = (c: Partial<typeof DEFAULT_INVOICE_STYLE.columns>) => ({
  ...DEFAULT_INVOICE_STYLE,
  columns: { ...DEFAULT_INVOICE_STYLE.columns, ...c },
});

describe('sanitizeInvoiceStyle', () => {
  it('returns the default style for empty/garbage input', () => {
    expect(sanitizeInvoiceStyle(undefined)).toEqual(DEFAULT_INVOICE_STYLE);
    expect(sanitizeInvoiceStyle(null)).toEqual(DEFAULT_INVOICE_STYLE);
    expect(sanitizeInvoiceStyle('nope')).toEqual(DEFAULT_INVOICE_STYLE);
  });

  it('clamps fontScale into range', () => {
    expect(sanitizeInvoiceStyle({ fontScale: 5 }).fontScale).toBe(FONT_SCALE_MAX);
    expect(sanitizeInvoiceStyle({ fontScale: 0.1 }).fontScale).toBe(FONT_SCALE_MIN);
    expect(sanitizeInvoiceStyle({ fontScale: 1.15 }).fontScale).toBe(1.15);
    expect(sanitizeInvoiceStyle({ fontScale: 'oops' }).fontScale).toBe(1);
  });

  it('drops invalid enums back to defaults but keeps valid ones', () => {
    const s = sanitizeInvoiceStyle({ density: 'spacious', logoSize: 'lg', logoAlign: 'center' });
    expect(s.density).toBe('normal'); // invalid → default
    expect(s.logoSize).toBe('lg'); // valid → kept
    expect(s.logoAlign).toBe('center'); // valid → kept
  });

  it('coerces the boolean polish flags', () => {
    const s = sanitizeInvoiceStyle({
      accentHeaderBand: true,
      emphasizeTotal: 'yes',
      colorHeadings: false,
    });
    expect(s.accentHeaderBand).toBe(true);
    expect(s.emphasizeTotal).toBe(true); // non-boolean → default (true)
    expect(s.colorHeadings).toBe(false);
  });
});

describe('metricsFor', () => {
  it('scales the body font with fontScale', () => {
    expect(metricsFor({ ...DEFAULT_INVOICE_STYLE, fontScale: 1 }).fontSize).toBe(9);
    expect(metricsFor({ ...DEFAULT_INVOICE_STYLE, fontScale: 1.25 }).fontSize).toBeGreaterThan(9);
  });

  it('maps density + logo size to concrete metrics', () => {
    const compact = metricsFor({ ...DEFAULT_INVOICE_STYLE, density: 'compact', logoSize: 'sm' });
    const relaxed = metricsFor({ ...DEFAULT_INVOICE_STYLE, density: 'relaxed', logoSize: 'lg' });
    expect(relaxed.pagePadTop).toBeGreaterThan(compact.pagePadTop);
    expect(relaxed.logoHeight).toBeGreaterThan(compact.logoHeight);
  });
});

describe('columns + colours', () => {
  it('sanitises columns + colours with sane defaults', () => {
    const s = sanitizeInvoiceStyle({});
    expect(s.columns).toEqual({ srNo: true, hsn: true, qtyRate: false, taxPct: false });
    expect(s.colors.tableHeaderBg).toBeNull();
    // invalid colour → null; valid hex kept (upper-cased)
    expect(sanitizeInvoiceStyle({ colors: { totalBg: 'red' } }).colors.totalBg).toBeNull();
    expect(sanitizeInvoiceStyle({ colors: { totalBg: '#abcdef' } }).colors.totalBg).toBe('#ABCDEF');
  });

  it('invoiceTableColumns: default columns sum to 100% with a flexible Description', () => {
    const cols = invoiceTableColumns(DEFAULT_INVOICE_STYLE);
    expect(cols.map((c) => c.key)).toEqual(['srNo', 'description', 'hsn', 'amount']);
    const sum = cols.reduce((a, c) => a + c.width, 0);
    expect(Math.round(sum)).toBe(100);
    expect(cols.find((c) => c.key === 'description')!.width).toBeGreaterThanOrEqual(20);
  });

  it('invoiceTableColumns: all columns present + still sum to 100%', () => {
    const cols = invoiceTableColumns(withCols({ qtyRate: true, taxPct: true }));
    expect(cols.map((c) => c.key)).toEqual([
      'srNo',
      'description',
      'hsn',
      'qty',
      'rate',
      'taxPct',
      'amount',
    ]);
    expect(Math.round(cols.reduce((a, c) => a + c.width, 0))).toBe(100);
    expect(cols.find((c) => c.key === 'amount')!.width).toBe(AMOUNT_COL_WIDTH);
  });

  it('readableTextOn picks readable text', () => {
    expect(readableTextOn('#0B3D91')).toBe('#FFFFFF'); // dark bg → white
    expect(readableTextOn('#F3F4F6')).toBe('#111111'); // light bg → dark
  });
});
