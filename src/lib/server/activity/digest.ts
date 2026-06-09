import 'server-only';

import { desc, eq, gte, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { entityActivityLog } from '@/lib/db/schema/entity_activity_log';
import { users } from '@/lib/db/schema/users';
import { sendEmail, type SendEmailResult } from '@/lib/server/email/send';

/**
 * Activity digest — a human-readable summary of recent actions on the panel,
 * built from the curated `entity_activity_log` stream. Deliberately
 * actor-free (no getActorContext) so the cron job can build it without a user
 * session, exactly like the reminder planner.
 */

export type DigestLine = {
  at: Date;
  actor: string;
  summary: string;
};

export type ActivityDigest = {
  subject: string;
  html: string;
  text: string;
  count: number;
  sinceHours: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the digest for the last `sinceHours` (default 24). */
export async function buildActivityDigest({
  sinceHours = 24,
  limit = 500,
}: { sinceHours?: number; limit?: number } = {}): Promise<ActivityDigest> {
  const rows = await db
    .select({
      createdAt: entityActivityLog.createdAt,
      actorName: users.fullName,
      entityType: entityActivityLog.entityType,
      kind: entityActivityLog.kind,
      summary: entityActivityLog.summary,
    })
    .from(entityActivityLog)
    .leftJoin(users, eq(users.id, entityActivityLog.actorId))
    .where(gte(entityActivityLog.createdAt, sql`now() - ${sinceHours} * interval '1 hour'`))
    .orderBy(desc(entityActivityLog.createdAt))
    .limit(limit);

  const lines: DigestLine[] = rows.map((r) => ({
    at: r.createdAt,
    actor: r.actorName ?? 'System',
    summary: r.summary ?? `${r.kind} · ${r.entityType}`,
  }));

  const count = lines.length;
  const windowLabel = sinceHours === 24 ? 'last 24 hours' : `last ${sinceHours} hours`;
  const subject = `Apār One — activity digest (${count} event${count === 1 ? '' : 's'}, ${windowLabel})`;

  const text = [
    `Apār One — activity digest`,
    `Window: ${windowLabel}`,
    `Events: ${count}`,
    '',
    ...(count === 0
      ? ['No activity recorded in this window.']
      : lines.map((l) => `• ${l.at.toLocaleString()} — ${l.actor}: ${l.summary}`)),
  ].join('\n');

  const rowsHtml =
    count === 0
      ? `<tr><td style="padding:8px;color:#6b5f58;">No activity recorded in this window.</td></tr>`
      : lines
          .map(
            (l) =>
              `<tr>` +
              `<td style="padding:6px 10px;white-space:nowrap;color:#6b5f58;font-size:12px;">${escapeHtml(l.at.toLocaleString())}</td>` +
              `<td style="padding:6px 10px;font-size:13px;"><strong>${escapeHtml(l.actor)}</strong> ${escapeHtml(l.summary)}</td>` +
              `</tr>`,
          )
          .join('');

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1411;">` +
    `<h2 style="margin:0 0 4px;">Apār One — activity digest</h2>` +
    `<p style="margin:0 0 12px;color:#6b5f58;font-size:13px;">${escapeHtml(windowLabel)} · ${count} event${count === 1 ? '' : 's'}</p>` +
    `<table style="border-collapse:collapse;width:100%;">${rowsHtml}</table>` +
    `</div>`;

  return { subject, html, text, count, sinceHours };
}

/** Build + send the digest to `to`. Returns the send result plus the event count. */
export async function sendActivityDigest({
  to,
  sinceHours = 24,
}: {
  to: string;
  sinceHours?: number;
}): Promise<SendEmailResult & { count: number }> {
  const digest = await buildActivityDigest({ sinceHours });
  const result = await sendEmail({
    to,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
  return { ...result, count: digest.count };
}
