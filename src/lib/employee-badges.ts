/**
 * Derived employee badges — no storage, everything computed from columns
 * that already exist on `employees` (joined_on, employment_type,
 * confirmed_on, status, designation).
 *
 *   - "New"        — joined within the last 30 days.
 *   - "Probation"  — first 6 months from joined_on for full-time/part-time
 *                    employees who have no confirmed_on yet; shows days left
 *                    and disappears once confirmed_on is set or the window
 *                    passes.
 *   - TL / Manager — designation-derived chip styling for leadership roles.
 *
 * Sync client-safe module (used by the OS Team cards and the employee
 * window header).
 */

import { todayIST } from './ist-date';

export const NEW_JOINER_WINDOW_DAYS = 30;
export const PROBATION_MONTHS = 6;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalise a joined_on value (YYYY-MM-DD string or Date) to YYYY-MM-DD. */
function toIsoDay(d: string | Date): string | null {
  if (d instanceof Date) {
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
}

/** Millisecond timestamp for a YYYY-MM-DD at UTC midnight. */
function dayMs(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/**
 * True when the employee joined within the last {@link NEW_JOINER_WINDOW_DAYS}
 * days (joined_on ≥ today − 30d, and not in the future). Statuses that mean
 * "no longer here" are the caller's concern.
 */
export function isNewJoiner(joinedOn: string | Date, today: string = todayIST()): boolean {
  const joined = toIsoDay(joinedOn);
  if (!joined) return false;
  const diffDays = Math.floor((dayMs(today) - dayMs(joined)) / MS_PER_DAY);
  return diffDays >= 0 && diffDays <= NEW_JOINER_WINDOW_DAYS;
}

/** joined_on + {@link PROBATION_MONTHS} calendar months, as YYYY-MM-DD. */
export function probationEndsOn(joinedOn: string | Date): string | null {
  const joined = toIsoDay(joinedOn);
  if (!joined) return null;
  const d = new Date(`${joined}T00:00:00Z`);
  const dayOfMonth = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + PROBATION_MONTHS);
  // Month-length clamp: Aug 31 + 6mo should be end-of-Feb, not Mar 2/3.
  if (d.getUTCDate() !== dayOfMonth) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Employment types that serve a probation period — interns included, since
 *  the founder treats them as probationary. Contractors/consultants are not. */
const PROBATION_EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'intern']);

export type ProbationInput = {
  joinedOn: string | Date;
  /** DB or UI employment type — probation applies to full/part-time/intern. */
  employmentType: string;
  confirmedOn?: string | null;
  /** Employee status; separated/prospective people never show the chip. */
  status?: string | null;
};

/**
 * Days remaining in the probation window, or null when the chip should be
 * hidden (confirmed, wrong employment type, window passed, separated, or a
 * future join date).
 */
export function probationDaysLeft(
  input: ProbationInput,
  today: string = todayIST(),
): number | null {
  if (input.confirmedOn) return null;
  if (!PROBATION_EMPLOYMENT_TYPES.has(input.employmentType)) return null;
  if (input.status === 'separated' || input.status === 'prospective') return null;
  const joined = toIsoDay(input.joinedOn);
  if (!joined || joined > today) return null;
  const endsOn = probationEndsOn(joined);
  if (!endsOn || endsOn <= today) return null;
  return Math.round((dayMs(endsOn) - dayMs(today)) / MS_PER_DAY);
}

/* -------------------------------------------------------------------------- */
/* Leadership designations                                                     */
/* -------------------------------------------------------------------------- */

/** Suggested options wherever designation is edited (free text otherwise). */
export const DESIGNATION_SUGGESTIONS: readonly string[] = ['Team Leader', 'Manager'];

/* -------------------------------------------------------------------------- */
/* Assignability                                                               */
/* -------------------------------------------------------------------------- */

/** Statuses that must NOT be offered when picking someone for active work
 *  (project member / project lead / assignee). Separated + inactive have left;
 *  prospective hasn't joined. on_leave / notice are still employed → allowed. */
const NON_ASSIGNABLE_STATUSES = new Set(['separated', 'inactive', 'prospective']);

/** True when this employee may be picked for active work. Unknown/absent
 *  status defaults to allowed (don't hide someone we can't classify). */
export function isAssignableEmployee(status?: string | null): boolean {
  return status == null || !NON_ASSIGNABLE_STATUSES.has(status);
}

export type LeadDesignationKind = 'team_leader' | 'manager';

/**
 * Case-insensitive match of a free-text designation onto the leadership
 * chips: anything containing "team lead(er)" or exactly "TL" is a Team
 * Leader; anything else containing "manager" is a Manager.
 */
export function designationLeadKind(
  designation: string | null | undefined,
): LeadDesignationKind | null {
  const d = (designation ?? '').trim().toLowerCase();
  if (!d) return null;
  if (d.includes('team lead') || d === 'tl') return 'team_leader';
  if (d.includes('manager')) return 'manager';
  return null;
}

export const LEAD_DESIGNATION_META: Record<LeadDesignationKind, { label: string; color: string }> =
  {
    team_leader: { label: 'Team Leader', color: '#2a9d8f' },
    manager: { label: 'Manager', color: '#8b5ad6' },
  };
