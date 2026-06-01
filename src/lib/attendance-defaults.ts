/**
 * Implicit attendance default for any (employee, date) without a stored
 * override:
 *   - Sundays → 'weekly_off'
 *   - Everything else → 'present'
 *
 * Lives outside `'use server'` so the synchronous helper can be imported
 * from client components (the Attendance app grid + per-employee
 * Attendance section both use it for rendering).
 */

import type { AttendanceStatus } from './server/entities/attendance';

export function defaultStatusForDate(iso: string): AttendanceStatus {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0) return 'weekly_off';
  return 'present';
}
