import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, formatPaiseForInput, parseRupeesToPaise } from './format-inr';

describe('formatINR', () => {
  it('formats zero', () => {
    expect(formatINR(0n)).toBe('₹0.00');
    expect(formatINR(0n, { showFraction: false })).toBe('₹0');
  });

  it('formats small amounts with paise', () => {
    expect(formatINR(150n)).toBe('₹1.50');
    expect(formatINR(99n)).toBe('₹0.99');
  });

  it('uses Indian grouping for lakhs and crores', () => {
    expect(formatINR(12_34_56_78_900n)).toBe('₹12,34,56,789.00');
    expect(formatINR(1_00_00_000_00n)).toBe('₹1,00,00,000.00');
  });

  it('handles negative values', () => {
    expect(formatINR(-150_00n)).toBe('-₹150.00');
  });

  it('respects showFraction=false', () => {
    expect(formatINR(123_45n, { showFraction: false })).toBe('₹123');
  });
});

describe('formatINRCompact', () => {
  it('returns ₹0 for zero', () => {
    expect(formatINRCompact(0n)).toBe('₹0');
  });

  it('uses full grouping below 10 lakh', () => {
    expect(formatINRCompact(99_999_00n)).toBe('₹99,999');
  });

  it('formats lakhs (10L) — boundary', () => {
    expect(formatINRCompact(10_00_000_00n)).toBe('₹10L');
  });

  it('formats lakhs with decimal', () => {
    expect(formatINRCompact(25_50_000_00n)).toBe('₹25.5L');
  });

  it('formats crores', () => {
    expect(formatINRCompact(1_00_00_000_00n)).toBe('₹1Cr');
    expect(formatINRCompact(3_25_00_000_00n)).toBe('₹3.25Cr');
  });

  it('handles negatives', () => {
    expect(formatINRCompact(-25_00_000_00n)).toBe('-₹25L');
  });
});

describe('parseRupeesToPaise', () => {
  it('parses plain integers', () => {
    expect(parseRupeesToPaise('1500')).toBe(150000n);
  });

  it('parses Indian-grouped input', () => {
    expect(parseRupeesToPaise('1,23,456.78')).toBe(12345678n);
  });

  it('strips a leading ₹ symbol', () => {
    expect(parseRupeesToPaise('₹ 1,000')).toBe(100000n);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('1.234')).toBeNull();
  });

  it('rejects compact suffixes (those are display-only)', () => {
    expect(parseRupeesToPaise('1.5L')).toBeNull();
    expect(parseRupeesToPaise('3Cr')).toBeNull();
  });

  it('handles negatives', () => {
    expect(parseRupeesToPaise('-500')).toBe(-50000n);
  });

  it('pads single-decimal-place inputs', () => {
    expect(parseRupeesToPaise('10.5')).toBe(1050n);
  });
});

describe('formatPaiseForInput', () => {
  it('returns empty string for null/undefined', () => {
    expect(formatPaiseForInput(null)).toBe('');
    expect(formatPaiseForInput(undefined)).toBe('');
  });

  it('formats with Indian grouping and forced 2 decimals', () => {
    expect(formatPaiseForInput(12345678n)).toBe('1,23,456.78');
    expect(formatPaiseForInput(0n)).toBe('0.00');
  });

  it('roundtrips with parseRupeesToPaise', () => {
    const original = 9_87_65_432n;
    const display = formatPaiseForInput(original);
    expect(parseRupeesToPaise(display)).toBe(original);
  });
});
