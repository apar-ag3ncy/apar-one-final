import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INVOICE_STYLE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  metricsFor,
  sanitizeInvoiceStyle,
} from './invoice-style';

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
