import { date, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { employees } from './employees';
import { leaves } from './salary';

/**
 * Attendance status per employee per day.
 *
 *   - present       — at the office (or wherever the work is).
 *   - work_from_home — remote attendance for the day.
 *   - absent         — unmarked / unpaid absence (no leave linked).
 *   - half_day       — partial-day presence; pair with a half-day leave.
 *   - on_leave       — formal leave; usually has leave_id set.
 *   - weekly_off     — Saturday / Sunday / configured weekly off.
 *   - holiday        — public / company holiday.
 *
 * SPEC-AMENDMENT-001 §8.4 — the "attendance % MTD" KPI on the employee
 * personal dashboard reads from this table.
 */
export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'work_from_home',
  'absent',
  'half_day',
  'on_leave',
  'weekly_off',
  'holiday',
]);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    ...timestamps(),
    ...auditColumns(),
    employeeId: uuid()
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** Date the status applies to. One row per (employee, date). */
    date: date().notNull(),
    status: attendanceStatusEnum().notNull(),
    /** Set when status='on_leave' — keeps the bookkeeping in sync. */
    leaveId: uuid().references(() => leaves.id, { onDelete: 'set null' }),
    notes: text(),
  },
  (t) => [
    uniqueIndex('attendance_employee_date_unique').on(t.employeeId, t.date),
    index().on(t.employeeId, t.date.desc()),
    index().on(t.date),
  ],
);

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;
