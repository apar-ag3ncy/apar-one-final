import { describe, expect, it } from 'vitest';

import {
  assertBigint,
  formatINR,
  formatINRCompact,
  paiseEqual,
  paiseToRupees,
  rupeesToPaise,
  sumPaise,
} from './money';

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise('100')).toBe(10000n);
    expect(rupeesToPaise(100)).toBe(10000n);
  });

  it('converts with two decimal places', () => {
    expect(rupeesToPaise('123.45')).toBe(12345n);
    expect(rupeesToPaise('0.01')).toBe(1n);
  });

  it('pads one-decimal input', () => {
    expect(rupeesToPaise('5.5')).toBe(550n);
  });

  it('handles zero', () => {
    expect(rupeesToPaise('0')).toBe(0n);
    expect(rupeesToPaise('0.00')).toBe(0n);
  });

  it('handles negative amounts', () => {
    expect(rupeesToPaise('-100')).toBe(-10000n);
    expect(rupeesToPaise('-0.50')).toBe(-50n);
  });

  it('rejects more than 2 decimals', () => {
    expect(() => rupeesToPaise('1.234')).toThrow(/2 decimals/);
  });

  it('rejects non-numeric strings', () => {
    expect(() => rupeesToPaise('abc')).toThrow(/valid INR/);
    expect(() => rupeesToPaise('1.2.3')).toThrow(/valid INR/);
  });

  it('rejects empty input', () => {
    expect(() => rupeesToPaise('')).toThrow(/empty/);
  });
});

describe('paiseToRupees', () => {
  it('converts paise to rupee decimal string', () => {
    expect(paiseToRupees(10000n)).toBe('100.00');
    expect(paiseToRupees(12345n)).toBe('123.45');
    expect(paiseToRupees(1n)).toBe('0.01');
    expect(paiseToRupees(0n)).toBe('0.00');
  });

  it('handles negative paise', () => {
    expect(paiseToRupees(-10000n)).toBe('-100.00');
    expect(paiseToRupees(-1n)).toBe('-0.01');
  });

  it('round-trips with rupeesToPaise', () => {
    for (const input of ['0.00', '1.00', '123.45', '99999.99', '-0.01', '-1234.56']) {
      expect(paiseToRupees(rupeesToPaise(input))).toBe(
        // Normalize: rupeesToPaise→paiseToRupees always gives 2-decimal
        input.includes('.') ? input : `${input}.00`,
      );
    }
  });

  it('throws on non-bigint', () => {
    expect(() => paiseToRupees(100 as unknown as bigint)).toThrow(/bigint/);
  });
});

describe('formatINR', () => {
  it('formats with Indian grouping + currency symbol', () => {
    const out = formatINR(10000000n); // ₹1,00,000.00
    expect(out).toContain('1,00,000');
    expect(out).toMatch(/₹/);
  });

  it('formats zero', () => {
    expect(formatINR(0n)).toMatch(/0/);
  });

  it('formats negative', () => {
    const out = formatINR(-10000n);
    expect(out).toMatch(/100/);
    expect(out).toMatch(/-/);
  });
});

describe('formatINRCompact', () => {
  it('uses compact notation for lakhs/crores', () => {
    const out = formatINRCompact(10000000n); // ₹1,00,000.00 → ₹1L
    expect(out).toMatch(/L|K/i);
  });
});

describe('sumPaise', () => {
  it('returns 0n for empty', () => {
    expect(sumPaise([])).toBe(0n);
  });

  it('sums positive values', () => {
    expect(sumPaise([100n, 200n, 300n])).toBe(600n);
  });

  it('sums mixed-sign values', () => {
    expect(sumPaise([100n, -50n, 25n])).toBe(75n);
  });

  it('rejects non-bigint elements', () => {
    expect(() => sumPaise([100n, 200 as unknown as bigint])).toThrow(/bigint/);
  });
});

describe('paiseEqual', () => {
  it('returns true for identical values', () => {
    expect(paiseEqual(100n, 100n)).toBe(true);
  });

  it('returns false for different values without tolerance', () => {
    expect(paiseEqual(100n, 101n)).toBe(false);
  });

  it('respects tolerance', () => {
    expect(paiseEqual(100n, 101n, 1n)).toBe(true);
    expect(paiseEqual(100n, 102n, 1n)).toBe(false);
  });
});

describe('assertBigint', () => {
  it('passes for bigint', () => {
    expect(() => assertBigint(100n)).not.toThrow();
  });

  it('throws for number', () => {
    expect(() => assertBigint(100)).toThrow(/bigint/);
  });

  it('throws for string', () => {
    expect(() => assertBigint('100')).toThrow(/bigint/);
  });

  it('throws for null/undefined', () => {
    expect(() => assertBigint(null)).toThrow(/bigint/);
    expect(() => assertBigint(undefined)).toThrow(/bigint/);
  });
});
