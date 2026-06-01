import { describe, expect, it } from 'vitest';

import { isGstImpactAllowed } from './credit-note-window';

describe('isGstImpactAllowed', () => {
  it('allows credit notes within the same FY as the invoice', () => {
    expect(isGstImpactAllowed('2025-12-15', '2025-04-01')).toBe(true);
    expect(isGstImpactAllowed('2025-04-15', '2025-04-01')).toBe(true);
  });

  it('allows credit notes up to and including Nov 30 of FY+1', () => {
    expect(isGstImpactAllowed('2026-11-30', '2025-04-01')).toBe(true);
    expect(isGstImpactAllowed('2026-11-15', '2025-04-01')).toBe(true);
  });

  it('disallows credit notes issued after Nov 30 of FY+1', () => {
    expect(isGstImpactAllowed('2026-12-01', '2025-04-01')).toBe(false);
    expect(isGstImpactAllowed('2027-04-01', '2025-04-01')).toBe(false);
  });

  it('throws on a malformed fyStart', () => {
    expect(() => isGstImpactAllowed('2025-06-01', 'not-a-date')).toThrow();
  });
});
