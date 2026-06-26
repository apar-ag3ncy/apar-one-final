import { describe, expect, it } from 'vitest';

import {
  STATUS_EXPORT_LABEL,
  eachIsoDate,
  normalizeStatus,
  toIsoDate,
  weekdayShort,
} from './attendance-io';

describe('normalizeStatus', () => {
  it('round-trips every export label', () => {
    for (const [status, label] of Object.entries(STATUS_EXPORT_LABEL)) {
      expect(normalizeStatus(label)).toBe(status);
    }
  });

  it('accepts common aliases and shorthands', () => {
    expect(normalizeStatus('WFH')).toBe('work_from_home');
    expect(normalizeStatus('work from home')).toBe('work_from_home');
    expect(normalizeStatus('P')).toBe('present');
    expect(normalizeStatus('Half Day')).toBe('half_day');
    expect(normalizeStatus('half-day')).toBe('half_day');
    expect(normalizeStatus('on leave')).toBe('on_leave');
    expect(normalizeStatus('weekly off')).toBe('weekly_off');
    expect(normalizeStatus(' Holiday ')).toBe('holiday');
  });

  it('returns null for blank or unknown input', () => {
    expect(normalizeStatus('')).toBeNull();
    expect(normalizeStatus('   ')).toBeNull();
    expect(normalizeStatus('vacation')).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('passes through ISO dates', () => {
    expect(toIsoDate('2026-06-22')).toBe('2026-06-22');
  });

  it('parses dd/mm/yyyy and dd-mm-yyyy', () => {
    expect(toIsoDate('22/06/2026')).toBe('2026-06-22');
    expect(toIsoDate('2-6-2026')).toBe('2026-06-02');
  });

  it('returns null for blank or unparseable input', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});

describe('eachIsoDate', () => {
  it('is inclusive of both ends', () => {
    expect(eachIsoDate('2026-06-22', '2026-06-24')).toEqual([
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
    ]);
  });

  it('returns a single day when from === to', () => {
    expect(eachIsoDate('2026-06-22', '2026-06-22')).toEqual(['2026-06-22']);
  });

  it('crosses month and year boundaries', () => {
    expect(eachIsoDate('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
    expect(eachIsoDate('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29', // 2024 is a leap year
      '2024-03-01',
    ]);
  });

  it('returns empty when from is after to', () => {
    expect(eachIsoDate('2026-06-24', '2026-06-22')).toEqual([]);
  });
});

describe('weekdayShort', () => {
  it('names the weekday for an ISO date', () => {
    // 2026-06-22 is a Monday, 2026-06-28 is a Sunday.
    expect(weekdayShort('2026-06-22')).toBe('Mon');
    expect(weekdayShort('2026-06-28')).toBe('Sun');
  });
});
