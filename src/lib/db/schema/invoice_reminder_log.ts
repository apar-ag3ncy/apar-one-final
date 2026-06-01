import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { invoices } from './invoices';

/**
 * Append-only log of dunning / reminder messages sent for an invoice.
 * The reminder cron (`/api/cron/billing-reminders`, Phase 9) reads
 * `reminder_schedules` (added in Phase 9), walks open invoices, fires
 * Resend emails, and writes one row here per send attempt.
 *
 * Status set by the email-send callback:
 *   - `sent`     — Resend accepted the message
 *   - `failed`   — Resend rejected (4xx/5xx); `errorMessage` carries detail
 *   - `bounced`  — recipient bounce reported via webhook (future)
 */
export const reminderChannelEnum = pgEnum('reminder_channel', ['email', 'sms']);

export const reminderStatusEnum = pgEnum('reminder_status', ['sent', 'failed', 'bounced']);

export const invoiceReminderLog = pgTable(
  'invoice_reminder_log',
  {
    ...timestamps(),
    ...auditColumns(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    channel: reminderChannelEnum().notNull(),
    templateUsed: text().notNull(), // 'gentle_nudge', 'firm_followup_30d', etc.
    recipient: text().notNull(), // email address or phone
    status: reminderStatusEnum().notNull(),
    errorMessage: text(),
  },
  (t) => [
    index().on(t.invoiceId, t.sentAt.desc()),
    index().on(t.sentAt.desc()),
    index().on(t.status),
  ],
);

export type InvoiceReminderLogEntry = typeof invoiceReminderLog.$inferSelect;
export type NewInvoiceReminderLogEntry = typeof invoiceReminderLog.$inferInsert;
