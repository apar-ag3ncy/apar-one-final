import { NextResponse } from 'next/server';

import { sendActivityDigest } from '@/lib/server/activity/digest';
import { readActivityDigestConfig } from '@/lib/server/settings/app-settings';

/**
 * Daily activity-digest cron.
 *
 * Emails a summary of the last 24h of panel activity to the recipient
 * configured in Settings → Notifications. Auth is the same shared-secret
 * pattern as the billing-reminders cron — no user session.
 *
 * Configure your scheduler (Vercel Cron / Supabase pg_cron / any URL pinger)
 * to call once a day:
 *   POST https://<host>/api/cron/activity-digest
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Requires CRON_SECRET, plus GMAIL_USER + GMAIL_APP_PASSWORD for delivery, and
 * a saved+enabled recipient in Settings. Any missing piece yields an explicit,
 * non-throwing response.
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
    const cfg = await readActivityDigestConfig();
    if (!cfg.enabled) {
      return NextResponse.json({ skipped: 'activity digest is disabled' }, { status: 200 });
    }
    if (!cfg.recipient) {
      return NextResponse.json({ skipped: 'no recipient configured' }, { status: 200 });
    }

    const result = await sendActivityDigest({ to: cfg.recipient, sinceHours: 24 });
    if (!result.ok) {
      return NextResponse.json(
        { sent: false, recipient: cfg.recipient, error: result.error },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { sent: true, recipient: cfg.recipient, events: result.count },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/activity-digest] failed:', err);
    return NextResponse.json({ error: 'cron failed', detail: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  // Mirror POST for schedulers that only support GET (Vercel cron).
  return POST(req);
}
