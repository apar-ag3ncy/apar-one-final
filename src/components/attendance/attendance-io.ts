// Shared helpers for the Attendance import/export dialogs — status labels,
// fuzzy parsers for uploaded cells, and small date utilities. Kept free of
// 'use client' / 'use server' so both dialogs (and tests) can import the
// pure functions directly.

import type { AttendanceStatus } from '@/lib/server/entities/attendance';

/** Human label written into an export file (round-trips via `normalizeStatus`). */
export const STATUS_EXPORT_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  work_from_home: 'Work from home',
  absent: 'Absent',
  half_day: 'Half-day',
  on_leave: 'On leave',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

// Accepted spellings → canonical status. Keys are pre-normalised (lower-cased,
// runs of space / slash / hyphen collapsed to a single underscore).
const STATUS_ALIASES: Record<string, AttendanceStatus> = {
  present: 'present',
  p: 'present',
  working: 'present',
  work: 'present',
  work_from_home: 'work_from_home',
  wfh: 'work_from_home',
  remote: 'work_from_home',
  w: 'work_from_home',
  absent: 'absent',
  a: 'absent',
  lop: 'absent',
  half_day: 'half_day',
  half: 'half_day',
  hd: 'half_day',
  h: 'half_day',
  on_leave: 'on_leave',
  leave: 'on_leave',
  l: 'on_leave',
  pl: 'on_leave',
  cl: 'on_leave',
  sl: 'on_leave',
  weekly_off: 'weekly_off',
  week_off: 'weekly_off',
  weekoff: 'weekly_off',
  off: 'weekly_off',
  wo: 'weekly_off',
  holiday: 'holiday',
  public_holiday: 'holiday',
  ph: 'holiday',
  x: 'holiday',
};

/** Coerce a free-text cell into an attendance status, or null if unrecognised. */
export function normalizeStatus(raw: string): AttendanceStatus | null {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  if (!v) return null;
  return STATUS_ALIASES[v] ?? null;
}

/** Coerce a cell into a YYYY-MM-DD string, or null if unparseable. */
export function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** Inclusive list of YYYY-MM-DD strings from `from` to `to` (UTC-stepped). */
export function eachIsoDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return out;
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Short weekday name for an ISO date, e.g. "Mon". */
export function weekdayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

/** All statuses, in the order shown across the attendance report columns. */
export const ALL_STATUSES: readonly AttendanceStatus[] = [
  'present',
  'work_from_home',
  'half_day',
  'on_leave',
  'absent',
  'weekly_off',
  'holiday',
];

/** Per-employee (or aggregate) attendance figures over a date range. */
export type AttendanceStats = {
  /** Count of each status across the range. */
  counts: Record<AttendanceStatus, number>;
  /** Calendar days summarised (sum of all counts). */
  totalDays: number;
  /** Scheduled working days = total − weekly-offs − holidays. */
  workingDays: number;
  /** Present-equivalent days = Present + WFH + ½·Half-day. */
  effectivePresent: number;
  /** Days absent. */
  absentDays: number;
  /** Days on leave. */
  leaveDays: number;
  /** effectivePresent ÷ workingDays × 100 (0 when no working days). */
  attendancePct: number;
};

/**
 * Tally an ordered list of effective statuses into attendance figures. Pure —
 * the caller resolves each (employee, date) to its effective status first
 * (stored override or the implicit default).
 */
export function computeAttendanceStats(statuses: readonly AttendanceStatus[]): AttendanceStats {
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    work_from_home: 0,
    absent: 0,
    half_day: 0,
    on_leave: 0,
    weekly_off: 0,
    holiday: 0,
  };
  for (const s of statuses) counts[s] += 1;

  const totalDays = statuses.length;
  const workingDays = totalDays - counts.weekly_off - counts.holiday;
  const effectivePresent = counts.present + counts.work_from_home + 0.5 * counts.half_day;
  const attendancePct = workingDays > 0 ? (effectivePresent / workingDays) * 100 : 0;

  return {
    counts,
    totalDays,
    workingDays,
    effectivePresent,
    absentDays: counts.absent,
    leaveDays: counts.on_leave,
    attendancePct,
  };
}

/** Sum several stat blocks into one aggregate (for the report totals row). */
export function aggregateAttendanceStats(blocks: readonly AttendanceStats[]): AttendanceStats {
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    work_from_home: 0,
    absent: 0,
    half_day: 0,
    on_leave: 0,
    weekly_off: 0,
    holiday: 0,
  };
  let totalDays = 0;
  for (const b of blocks) {
    for (const s of ALL_STATUSES) counts[s] += b.counts[s];
    totalDays += b.totalDays;
  }
  const workingDays = totalDays - counts.weekly_off - counts.holiday;
  const effectivePresent = counts.present + counts.work_from_home + 0.5 * counts.half_day;
  const attendancePct = workingDays > 0 ? (effectivePresent / workingDays) * 100 : 0;
  return {
    counts,
    totalDays,
    workingDays,
    effectivePresent,
    absentDays: counts.absent,
    leaveDays: counts.on_leave,
    attendancePct,
  };
}
