import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { auditColumns, timestamps } from './_shared';
import { clients } from './clients';

/**
 * Per-customer (or global default) dunning configuration. Drives the
 * daily reminder cron at `src/app/api/cron/billing-reminders/route.ts`.
 *
 * `rules` is a JSONB array of objects shaped:
 *   { offset_days: number, template: string, channel: 'email' | 'sms' }
 * Negative offset means BEFORE due date (e.g. -3 = "3 days before due").
 *
 * Exactly one row with `client_id IS NULL` is allowed (the global
 * default). Per-client schedules are also unique (one schedule per
 * client). Disabling via `is_active=false` pauses sends without
 * deleting history; `invoice_reminder_log` records what was sent.
 */
export const reminderSchedules = pgTable(
  'reminder_schedules',
  {
    ...timestamps(),
    ...auditColumns(),
    /** NULL = global default. */
    clientId: uuid().references(() => clients.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    isActive: boolean().notNull().default(true),
    rules: jsonb().notNull().default([]),
    notes: text(),
  },
  (t) => [
    uniqueIndex('reminder_schedules_global_default_unique')
      .on(sql`(${t.clientId} IS NULL)`)
      .where(sql`${t.clientId} IS NULL`),
    uniqueIndex('reminder_schedules_client_id_unique')
      .on(t.clientId)
      .where(sql`${t.clientId} IS NOT NULL`),
    index().on(t.isActive),
  ],
);

export type ReminderSchedule = typeof reminderSchedules.$inferSelect;
export type NewReminderSchedule = typeof reminderSchedules.$inferInsert;

export type ReminderRule = {
  offset_days: number;
  template: string;
  channel: 'email' | 'sms';
};
