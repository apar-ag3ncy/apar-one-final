'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db/client';
import {
  entityContacts,
  invoiceReminderLog,
  invoices,
  reminderSchedules,
  type ReminderRule,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Reminder-schedule CRUD + the cron-side decideRemindersForToday()
 * planner. Phase 9.
 *
 * The cron handler at src/app/api/cron/billing-reminders/route.ts
 * calls runDailyReminderCron() which:
 *   1. decideRemindersForToday() → list of (invoice, schedule_rule)
 *      pairs that fire today.
 *   2. For each: pull recipient email from entity_contacts,
 *      send via Resend (Phase 9 dep TBD), write an
 *      invoice_reminder_log row per attempt.
 *
 * Resend (or any email sender) is abstracted behind a sendEmail()
 * callback so the planner is unit-testable without network. The
 * default callback is a no-op stub that logs to console + writes a
 * 'sent' log row; swap in the real Resend impl when the dep is
 * approved.
 */

const RuleSchema = z.object({
  offset_days: z.number().int().min(-365).max(365),
  template: z.string().trim().min(1).max(120),
  channel: z.enum(['email', 'sms']),
});

const UpsertScheduleInputSchema = z.object({
  /** NULL = global default. */
  clientId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean().default(true),
  rules: z.array(RuleSchema).min(1),
  notes: z.string().trim().max(2000).nullish(),
});

export type UpsertScheduleInput = z.input<typeof UpsertScheduleInputSchema>;

export async function upsertReminderSchedule(input: UpsertScheduleInput): Promise<{ id: string }> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_recurring');
  const v = UpsertScheduleInputSchema.parse(input);

  // Both client_id IS NULL (global default) and per-client schedules
  // are unique. Upsert via ON CONFLICT on the matching partial index.
  const target = v.clientId
    ? sql`(client_id) WHERE client_id IS NOT NULL`
    : sql`((client_id IS NULL)) WHERE client_id IS NULL`;
  // Drizzle's onConflictDoUpdate with a partial-index target is awkward;
  // we manually SELECT first and UPDATE-or-INSERT.
  const existing = await db
    .select({ id: reminderSchedules.id })
    .from(reminderSchedules)
    .where(
      v.clientId ? eq(reminderSchedules.clientId, v.clientId) : isNull(reminderSchedules.clientId),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(reminderSchedules)
      .set({
        name: v.name,
        isActive: v.isActive,
        rules: v.rules,
        notes: v.notes ?? null,
        updatedBy: ctx.userId,
      })
      .where(eq(reminderSchedules.id, existing[0].id));
    return { id: existing[0].id };
  }

  const [row] = await db
    .insert(reminderSchedules)
    .values({
      clientId: v.clientId ?? null,
      name: v.name,
      isActive: v.isActive,
      rules: v.rules,
      notes: v.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: reminderSchedules.id });
  if (!row) throw new AppError('internal', 'reminder_schedules.insert returned no row');
  // Touch `target` to satisfy unused-var lint until we wire ON CONFLICT.
  void target;
  return { id: row.id };
}

export async function listReminderSchedules(): Promise<
  Array<typeof reminderSchedules.$inferSelect>
> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_recurring');
  return db.select().from(reminderSchedules).orderBy(reminderSchedules.name);
}

export async function deleteReminderSchedule(id: string): Promise<void> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_recurring');
  const parsedId = z.string().uuid().parse(id);
  await db.delete(reminderSchedules).where(eq(reminderSchedules.id, parsedId));
}

/* -------------------------------------------------------------------------- */
/* decideRemindersForToday — planner                                          */
/* -------------------------------------------------------------------------- */

export type DueReminder = {
  invoiceId: string;
  documentNumber: string;
  clientId: string;
  dueDate: string | null;
  rule: ReminderRule;
  /** Days offset from due (matches rule.offset_days). */
  offsetDays: number;
};

/**
 * Walk open invoices + their applicable reminder_schedule, return the
 * (invoice, rule) pairs whose offset_days matches today's distance
 * from due_date AND haven't already been logged for today.
 *
 * "Today" is IST calendar day.
 */
export async function decideRemindersForToday(
  todayIst: string = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10),
): Promise<DueReminder[]> {
  // 1. Pull open invoices with a due_date.
  const openInvoices = await db
    .select({
      invoiceId: invoices.id,
      documentNumber: invoices.documentNumber,
      clientId: invoices.clientId,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .where(
      and(
        sql`${invoices.state} IN ('sent', 'partially_paid')`,
        sql`${invoices.dueDate} IS NOT NULL`,
      ),
    );

  if (openInvoices.length === 0) return [];

  // 2. Pull all active schedules + index by clientId (with null = default).
  const schedules = await db
    .select()
    .from(reminderSchedules)
    .where(eq(reminderSchedules.isActive, true));
  const scheduleByClient = new Map<string | null, typeof schedules>();
  for (const s of schedules) {
    const arr = scheduleByClient.get(s.clientId) ?? [];
    arr.push(s);
    scheduleByClient.set(s.clientId, arr);
  }
  const globalDefault = scheduleByClient.get(null) ?? [];

  // 3. Pull today's already-sent rows so we don't re-fire.
  const sentToday = await db
    .select({
      invoiceId: invoiceReminderLog.invoiceId,
      templateUsed: invoiceReminderLog.templateUsed,
    })
    .from(invoiceReminderLog)
    .where(sql`DATE(${invoiceReminderLog.sentAt} AT TIME ZONE 'Asia/Kolkata') = ${todayIst}`);
  const sentKey = (i: string, t: string) => `${i}::${t}`;
  const alreadySent = new Set<string>();
  for (const r of sentToday) alreadySent.add(sentKey(r.invoiceId, r.templateUsed));

  // 4. For each invoice, pick the applicable schedule + check today's rules.
  const due: DueReminder[] = [];
  for (const inv of openInvoices) {
    if (!inv.dueDate) continue;
    const schedule = (scheduleByClient.get(inv.clientId) ?? globalDefault)[0];
    if (!schedule) continue;
    const rules = (schedule.rules as ReminderRule[]) ?? [];
    const daysFromDue = daysBetween(todayIst, inv.dueDate);
    for (const rule of rules) {
      if (rule.offset_days !== daysFromDue) continue;
      if (alreadySent.has(sentKey(inv.invoiceId, rule.template))) continue;
      due.push({
        invoiceId: inv.invoiceId,
        documentNumber: inv.documentNumber,
        clientId: inv.clientId,
        dueDate: inv.dueDate,
        rule,
        offsetDays: rule.offset_days,
      });
    }
  }
  return due;
}

function daysBetween(aIso: string, bIso: string): number {
  // a - b in days (positive if a is later). Both YYYY-MM-DD.
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

/* -------------------------------------------------------------------------- */
/* runDailyReminderCron — invoked by /api/cron/billing-reminders              */
/* -------------------------------------------------------------------------- */

export type ReminderSendResult = {
  invoiceId: string;
  template: string;
  recipient: string | null;
  status: 'sent' | 'skipped' | 'failed';
  errorMessage?: string;
};

/**
 * Pluggable email sender. Default impl writes a 'sent' log line and
 * does nothing else (Phase 9 dep ask for Resend). Real impl swaps in
 * a real email send + handles the bounce webhook for 'bounced' status.
 */
export type SendEmailFn = (args: {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

const defaultSendEmail: SendEmailFn = async (args) => {
  // Stub: log and pretend success. Resend impl replaces this.
  // eslint-disable-next-line no-console
  console.warn(
    `[reminders/stub] would send "${args.subject}" to ${args.to}: ${args.bodyText.slice(0, 80)}…`,
  );
  return { ok: true };
};

export async function runDailyReminderCron(sendEmail: SendEmailFn = defaultSendEmail): Promise<{
  ranAt: string;
  sent: number;
  failed: number;
  skipped: number;
  results: ReminderSendResult[];
}> {
  // Cron runs as service-role — bypass the user capability check.
  const due = await decideRemindersForToday();
  const results: ReminderSendResult[] = [];

  for (const d of due) {
    // Pull recipient email — first primary contact, else first contact.
    const contacts = await db
      .select({ email: entityContacts.email, isPrimary: entityContacts.isPrimary })
      .from(entityContacts)
      .where(and(eq(entityContacts.entityType, 'client'), eq(entityContacts.entityId, d.clientId)));
    const recipient =
      contacts.find((c) => c.isPrimary && c.email)?.email ??
      contacts.find((c) => c.email)?.email ??
      null;

    if (!recipient) {
      results.push({
        invoiceId: d.invoiceId,
        template: d.rule.template,
        recipient: null,
        status: 'skipped',
        errorMessage: 'No client contact email available.',
      });
      continue;
    }

    const subject =
      d.offsetDays < 0
        ? `Reminder: invoice ${d.documentNumber} due in ${-d.offsetDays} days`
        : d.offsetDays === 0
          ? `Invoice ${d.documentNumber} is due today`
          : `Invoice ${d.documentNumber} overdue by ${d.offsetDays} days`;
    const bodyText = `Invoice ${d.documentNumber} ${d.offsetDays >= 0 ? 'is past due' : 'is upcoming'}. Please settle at your earliest convenience.`;
    const bodyHtml = `<p>${bodyText}</p>`;

    const send = await sendEmail({ to: recipient, subject, bodyHtml, bodyText });

    await db.insert(invoiceReminderLog).values({
      invoiceId: d.invoiceId,
      sentAt: new Date(),
      channel: d.rule.channel,
      templateUsed: d.rule.template,
      recipient,
      status: send.ok ? 'sent' : 'failed',
      errorMessage: send.ok ? null : send.error,
    });

    if (send.ok) {
      await logActivity({
        entityType: 'client',
        entityId: d.clientId,
        actorId: '00000000-0000-0000-0000-000000000000', // system cron actor
        kind: 'reminder.sent',
        summary: `Reminder ${d.rule.template} sent for ${d.documentNumber}`,
        payload: {
          invoice_id: d.invoiceId,
          document_number: d.documentNumber,
          template: d.rule.template,
          recipient,
          offset_days: d.offsetDays,
        },
      });
      results.push({
        invoiceId: d.invoiceId,
        template: d.rule.template,
        recipient,
        status: 'sent',
      });
    } else {
      results.push({
        invoiceId: d.invoiceId,
        template: d.rule.template,
        recipient,
        status: 'failed',
        errorMessage: send.error,
      });
    }
  }

  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { sent: 0, failed: 0, skipped: 0 },
  );

  // Single audit row for the entire run so the partner can see "cron ran today".
  await logAudit({
    actorId: null,
    entityType: 'billing_cron',
    entityId: '00000000-0000-0000-0000-000000000000',
    action: 'insert',
    changes: { ...counts, decided: due.length },
  });

  return { ranAt: new Date().toISOString(), ...counts, results };
}
