import { describe, expect, it } from 'vitest';

import {
  STATUS_EXPORT_LABEL,
  aggregateAttendanceStats,
  computeAttendanceStats,
  eachIsoDate,
  normalizeStatus,
  splitIntoMonths,
  toIsoDate,
  weekdayShort,
} from './attendance-io';
import type { AttendanceStatus } from '@/lib/server/entities/attendance';

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

const S = (parts: Partial<Record<AttendanceStatus, number>>): AttendanceStatus[] => {
  const out: AttendanceStatus[] = [];
  for (const [k, n] of Object.entries(parts)) {
    for (let i = 0; i < (n ?? 0); i++) out.push(k as AttendanceStatus);
  }
  return out;
};

describe('computeAttendanceStats', () => {
  it('counts statuses and derives working days + attendance %', () => {
    // 22 present, 1 absent, 1 half-day, 1 on-leave, 4 weekly-off, 1 holiday = 30 days.
    const stats = computeAttendanceStats(
      S({ present: 22, absent: 1, half_day: 1, on_leave: 1, weekly_off: 4, holiday: 1 }),
    );
    expect(stats.totalDays).toBe(30);
    // working = 30 − 4 weekly-off − 1 holiday = 25
    expect(stats.workingDays).toBe(25);
    expect(stats.counts.present).toBe(22);
    expect(stats.absentDays).toBe(1);
    expect(stats.leaveDays).toBe(1);
    // effective present = 22 + 0 WFH + 0.5·1 half = 22.5
    expect(stats.effectivePresent).toBe(22.5);
    // 22.5 / 25 = 90%
    expect(stats.attendancePct).toBeCloseTo(90, 5);
  });

  it('counts WFH as present and half-days as 0.5', () => {
    const stats = computeAttendanceStats(S({ present: 1, work_from_home: 1, half_day: 1 }));
    expect(stats.workingDays).toBe(3);
    expect(stats.effectivePresent).toBe(2.5); // 1 + 1 + 0.5
    expect(stats.attendancePct).toBeCloseTo((2.5 / 3) * 100, 5);
  });

  it('returns 0% when there are no working days (all weekly-off/holiday)', () => {
    const stats = computeAttendanceStats(S({ weekly_off: 2, holiday: 1 }));
    expect(stats.workingDays).toBe(0);
    expect(stats.attendancePct).toBe(0);
  });
});

describe('splitIntoMonths', () => {
  it('groups consecutive dates into calendar months, preserving in-range days', () => {
    const groups = splitIntoMonths(eachIsoDate('2026-05-30', '2026-07-02'));
    expect(groups.map((g) => g.label)).toEqual(['May 2026', 'June 2026', 'July 2026']);
    expect(groups[0]!.days).toEqual(['2026-05-30', '2026-05-31']); // partial month at the start
    expect(groups[1]!.days).toHaveLength(30); // all of June
    expect(groups[2]!.days).toEqual(['2026-07-01', '2026-07-02']); // partial month at the end
    expect(groups[1]!.year).toBe(2026);
    expect(groups[1]!.month).toBe(6);
  });

  it('returns a single group for a single month', () => {
    const groups = splitIntoMonths(eachIsoDate('2026-06-01', '2026-06-30'));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days).toHaveLength(30);
  });

  it('handles an empty list', () => {
    expect(splitIntoMonths([])).toEqual([]);
  });
});

describe('aggregateAttendanceStats', () => {
  it('sums per-employee blocks into a correct total', () => {
    const a = computeAttendanceStats(S({ present: 20, absent: 2, weekly_off: 4 }));
    const b = computeAttendanceStats(S({ present: 18, on_leave: 4, weekly_off: 4 }));
    const total = aggregateAttendanceStats([a, b]);
    expect(total.counts.present).toBe(38);
    expect(total.absentDays).toBe(2);
    expect(total.leaveDays).toBe(4);
    expect(total.totalDays).toBe(a.totalDays + b.totalDays);
    expect(total.workingDays).toBe(a.workingDays + b.workingDays);
    expect(total.effectivePresent).toBe(38);
  });

  it('aggregates empty input to zeroes', () => {
    const total = aggregateAttendanceStats([]);
    expect(total.totalDays).toBe(0);
    expect(total.workingDays).toBe(0);
    expect(total.attendancePct).toBe(0);
  });
});
