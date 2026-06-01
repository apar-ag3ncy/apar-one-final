import { NextResponse } from 'next/server';

import { runDailyReminderCron } from '@/lib/server/billing/reminders';

/**
 * Daily reminder cron — Phase 9.2.
 *
 * Invoked by Supabase pg_cron OR Vercel's scheduled functions OR any
 * external scheduler that can hit a URL. Idempotent within a calendar
 * day (the planner dedupes against invoice_reminder_log entries for
 * today).
 *
 * Auth: shared-secret in the `Authorization: Bearer …` header. We
 * deliberately don't use the user-session client — this runs without
 * a user.
 *
 * Configure the scheduler to call:
 *   POST https://<host>/api/cron/billing-reminders
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Set CRON_SECRET in .env.local + Vercel project env vars. Reject any
 * request that doesn't carry it.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'cron not configured; set CRON_SECRET env var.' },
      { status: 503 },
    );
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    // No sendEmail param — uses the default stub. When Resend is wired,
    // swap in the real impl here OR globally via dependency injection
    // (e.g. lib/server/billing/email-sender.ts factory).
    const result = await runDailyReminderCron();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[cron/billing-reminders] failed:', err);
    return NextResponse.json({ error: 'cron failed', detail: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  // Mirror POST for schedulers that only support GET (Vercel cron).
  return POST(req);
}
