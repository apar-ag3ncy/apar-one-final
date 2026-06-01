import { addDays, addMonths, format, isAfter, isBefore } from 'date-fns';

/**
 * Date helpers. CLAUDE rule #24 + #41:
 *
 *   - Storage is UTC.
 *   - Display is IST (`DD MMM YYYY`).
 *   - Financial Year is April 1 – March 31. **Only for filtering/labels.**
 *     Never used in computation of amounts (no FY proration etc.).
 *
 * `fiscalYear()` follows the Indian convention where "FY 2026" = the year
 * ending 31 March 2026 = the period 1 April 2025 – 31 March 2026.
 * `periodMonth()` returns 1..12 with month 1 = April, matching the brief's
 * "month 1 = April" decision for the `periods` table.
 */

const IST_TZ_OFFSET_HOURS = 5.5; // for display helpers; date-fns-tz is heavier than we need here

/**
 * Indian FY for the given date. The convention is "FY = the year of the
 * March-ending boundary" — so 15 Aug 2025 is in FY 2026, 15 Feb 2026 is
 * also in FY 2026, and 15 Apr 2026 is in FY 2027.
 */
export function fiscalYear(date: Date): number {
  const m = date.getMonth(); // 0-indexed; Jan=0, Apr=3
  const y = date.getFullYear();
  return m >= 3 ? y + 1 : y;
}

/**
 * Period month (1..12) where month 1 = April. Brief decision for the
 * `periods` table.
 */
export function periodMonth(date: Date): number {
  // Apr=3 → 1, May=4 → 2, ..., Mar=2 → 12
  const m = date.getMonth();
  return m >= 3 ? m - 2 : m + 10;
}

/** Start of FY (1 April of FY-1). */
export function fiscalYearStart(fy: number): Date {
  return new Date(Date.UTC(fy - 1, 3, 1, 0, 0, 0, 0));
}

/** End of FY (31 March of FY). */
export function fiscalYearEnd(fy: number): Date {
  return new Date(Date.UTC(fy, 2, 31, 23, 59, 59, 999));
}

/** Inclusive bounds of a specific period (month 1..12 + fy). */
export function periodBounds(
  fiscalYearNum: number,
  month1to12: number,
): { startsOn: Date; endsOn: Date } {
  // month 1 = April of (fy-1), month 12 = March of fy
  const offsetMonths = month1to12 - 1;
  const startsOn = addMonths(fiscalYearStart(fiscalYearNum), offsetMonths);
  const endsOn = addDays(addMonths(startsOn, 1), -1);
  return { startsOn, endsOn };
}

/** Format a date in IST as `DD MMM YYYY` (CLAUDE rule #41). */
export function formatDateIST(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Cheap IST: add 5h30m. For exact DST-free IST display this is fine.
  const ist = new Date(d.getTime() + IST_TZ_OFFSET_HOURS * 60 * 60 * 1000);
  return format(ist, 'dd MMM yyyy');
}

export function isWithinPeriod(date: Date, fy: number, month1to12: number): boolean {
  const { startsOn, endsOn } = periodBounds(fy, month1to12);
  return !isBefore(date, startsOn) && !isAfter(date, endsOn);
}
