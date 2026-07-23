/**
 * Derived employee badges — no storage, everything computed from columns
 * that already exist on `employees` (joined_on, employment_type,
 * confirmed_on, status, designation).
 *
 *   - "New"        — joined within the last 30 days.
 *   - "Probation"  — ONLY when an admin has set an explicit probation end
 *                    date on the employee; shows days left and disappears once
 *                    that date passes or confirmed_on is set. Never derived.
 *   - TL / Manager — designation-derived chip styling for leadership roles.
 *
 * Sync client-safe module (used by the OS Team cards and the employee
 * window header).
 */

import { todayIST } from './ist-date';

export const NEW_JOINER_WINDOW_DAYS = 30;

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

/**
 * `startIso` + N months + M days, as YYYY-MM-DD. Powers the probation-duration
 * input (the founder enters "how many months / days"). Months apply first with a
 * month-length clamp (Aug 31 + 6mo → end-of-Feb, not Mar 2/3), then days.
 */
export function addMonthsDays(
  startIso: string | Date,
  months: number,
  days: number,
): string | null {
  const start = toIsoDay(startIso);
  if (!start) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (months) {
    const dayOfMonth = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);
    if (d.getUTCDate() !== dayOfMonth) d.setUTCDate(0);
  }
  if (days) d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Inverse of {@link addMonthsDays}: the whole-months + remaining-days duration
 * from `startIso` to `endIso`. Used to prefill the editor from a stored end date
 * so it round-trips (addMonthsDays(start, months, days) === end). Null if end < start.
 */
export function splitMonthsDays(
  startIso: string | Date,
  endIso: string | Date,
): { months: number; days: number } | null {
  const start = toIsoDay(startIso);
  const end = toIsoDay(endIso);
  if (!start || !end || end < start) return null;
  let months = 0;
  for (;;) {
    const next = addMonthsDays(start, months + 1, 0);
    if (!next || next > end) break;
    months += 1;
  }
  const anchor = addMonthsDays(start, months, 0) ?? start;
  const days = Math.round((dayMs(end) - dayMs(anchor)) / MS_PER_DAY);
  return { months, days };
}

export type ProbationInput = {
  joinedOn: string | Date;
  /** Kept for callers' convenience; no longer affects whether probation shows. */
  employmentType: string;
  confirmedOn?: string | null;
  /**
   * Explicit probation end date (0081). This is now the ONLY thing that puts
   * someone on probation — set deliberately by an admin, and cleared to null
   * when the employee is confirmed. There is no implicit window.
   */
  probationEndsOn?: string | null;
  /** Employee status; separated/prospective people never show the chip. */
  status?: string | null;
};

/**
 * The effective probation end date, or null when the person isn't on probation.
 *
 * PROBATION IS ADMIN-DECIDED. It is shown only where an explicit
 * `probationEndsOn` has been set on the employee record.
 *
 * This used to FALL BACK to a derived 6-month-from-joining window for
 * full-time / part-time / intern employees, so people carried a probation
 * badge nobody had actually put them on (an intern with no probation date on
 * record still showed "Probation · N days left"). Now that employees can see
 * their own record, a status nobody set must not be shown. Clearing the date
 * ends probation; there is no implicit window.
 */
export function effectiveProbationEnd(
  input: ProbationInput,
  today: string = todayIST(),
): string | null {
  if (input.confirmedOn) return null;
  if (input.status === 'separated' || input.status === 'prospective') return null;
  const joined = toIsoDay(input.joinedOn);
  if (!joined || joined > today) return null;
  const endsOn = input.probationEndsOn ? toIsoDay(input.probationEndsOn) : null;
  if (!endsOn || endsOn <= today) return null;
  return endsOn;
}

/**
 * Days remaining in the probation window, or null when the chip should be
 * hidden (confirmed, no probation date set, window passed, separated, or a
 * future join date).
 */
export function probationDaysLeft(
  input: ProbationInput,
  today: string = todayIST(),
): number | null {
  const endsOn = effectiveProbationEnd(input, today);
  if (!endsOn) return null;
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

/** Settings-managed leadership role lists (Settings → Team → Team policies). */
export type LeadRolePolicy = {
  teamLeaderRoles: readonly string[];
  managerialRoles: readonly string[];
};

/**
 * A designation matches a configured role when, lowercased, it equals the
 * role or contains it as a phrase ("Senior Team Leader" matches "Team
 * Leader"; short roles like "TL" match only exactly so "TLV" doesn't).
 */
function matchesRole(designation: string, roles: readonly string[]): boolean {
  return roles.some((role) => {
    const r = role.trim().toLowerCase();
    if (!r) return false;
    return r.length <= 3 ? designation === r : designation.includes(r);
  });
}

/**
 * Policy-aware {@link designationLeadKind}: matches against the
 * settings-managed role lists, falling back to the built-in heuristic when
 * no policy is loaded. Team-leader roles win over managerial ones when a
 * designation matches both.
 */
export function designationLeadKindWith(
  designation: string | null | undefined,
  policy: LeadRolePolicy | null | undefined,
): LeadDesignationKind | null {
  if (!policy) return designationLeadKind(designation);
  const d = (designation ?? '').trim().toLowerCase();
  if (!d) return null;
  if (matchesRole(d, policy.teamLeaderRoles)) return 'team_leader';
  if (matchesRole(d, policy.managerialRoles)) return 'manager';
  return null;
}

export const LEAD_DESIGNATION_META: Record<LeadDesignationKind, { label: string; color: string }> =
  {
    team_leader: { label: 'Team Leader', color: '#2a9d8f' },
    manager: { label: 'Manager', color: '#8b5ad6' },
  };
