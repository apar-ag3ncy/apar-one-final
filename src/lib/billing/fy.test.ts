import { describe, expect, it } from 'vitest';

import { formatDocumentNumber, fyLabelForDate, fyStartForDate, parseSequence } from './fy';

describe('fyStartForDate', () => {
  it('returns April 1 of the SAME year for dates on or after April 1', () => {
    expect(fyStartForDate('2025-04-01')).toBe('2025-04-01');
    expect(fyStartForDate('2025-04-15')).toBe('2025-04-01');
    expect(fyStartForDate('2025-12-31')).toBe('2025-04-01');
    expect(fyStartForDate('2026-03-31')).toBe('2025-04-01');
  });

  it('returns April 1 of the PREVIOUS year for dates before April 1', () => {
    expect(fyStartForDate('2025-03-31')).toBe('2024-04-01');
    expect(fyStartForDate('2025-01-15')).toBe('2024-04-01');
  });

  it('honours a non-default fyStartMonth', () => {
    // Calendar-year FY (Jan 1)
    expect(fyStartForDate('2025-12-31', 1)).toBe('2025-01-01');
    expect(fyStartForDate('2025-01-01', 1)).toBe('2025-01-01');
  });

  it('throws on invalid dateIso', () => {
    expect(() => fyStartForDate('not-a-date')).toThrow();
  });
});

describe('fyLabelForDate', () => {
  it('produces the YYYY-YY label for the Indian FY', () => {
    expect(fyLabelForDate('2025-04-01')).toBe('2025-26');
    expect(fyLabelForDate('2026-03-31')).toBe('2025-26');
    expect(fyLabelForDate('2026-04-01')).toBe('2026-27');
  });

  it('handles the century rollover', () => {
    expect(fyLabelForDate('2099-04-01')).toBe('2099-00');
  });
});

describe('formatDocumentNumber', () => {
  it('formats with the default mask', () => {
    expect(formatDocumentNumber('INV', '2025-26', 1)).toBe('INV/2025-26/0001');
    expect(formatDocumentNumber('RV', '2025-26', 42)).toBe('RV/2025-26/0042');
  });

  it('respects a custom mask with a different seq width', () => {
    expect(formatDocumentNumber('CN', '2025-26', 7, '{prefix}-{fy}-{seq:06}')).toBe(
      'CN-2025-26-000007',
    );
  });
});

describe('parseSequence', () => {
  it('inverts formatDocumentNumber for the default mask', () => {
    expect(parseSequence('INV/2025-26/0001')).toBe(1);
    expect(parseSequence('INV/2025-26/9999')).toBe(9999);
  });

  it('returns NaN for unconforming strings', () => {
    expect(Number.isNaN(parseSequence('not-a-number'))).toBe(true);
  });
});
