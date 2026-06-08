import 'server-only';

/**
 * Transactional email sender. Uses Resend's REST API directly via `fetch`
 * (no SDK dependency). This is the real implementation behind the app's
 * `SendEmailFn` seam (see lib/server/billing/reminders.ts) and the activity
 * digest.
 *
 * Configuration (set in `.env.local`, never committed):
 *   RESEND_API_KEY   — your Resend API key (re_…)
 *   EMAIL_FROM       — verified sender, e.g. "Apār One <reports@yourdomain.com>"
 *                      (Resend requires a verified domain; for testing you can
 *                      use "onboarding@resend.dev", which only delivers to the
 *                      Resend account owner's address.)
 *   EMAIL_PROVIDER   — optional, defaults to "resend".
 *
 * Returns a discriminated result so callers can log/report failures without
 * throwing. Never logs the API key.
 */

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

/** True when the provider is configured enough to attempt a send. */
export function isEmailConfigured(): boolean {
  const provider = (process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase();
  if (provider === 'resend') {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  }
  return false;
}

/** Human-readable reason the sender isn't ready (for surfacing in the UI). */
export function emailConfigError(): string | null {
  const provider = (process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase();
  if (provider !== 'resend') {
    return `Unsupported EMAIL_PROVIDER "${provider}". Set it to "resend" (or leave it unset).`;
  }
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!process.env.EMAIL_FROM) missing.push('EMAIL_FROM');
  return missing.length > 0 ? `Email is not configured — set ${missing.join(' and ')}.` : null;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const configError = emailConfigError();
  if (configError) return { ok: false, error: configError };

  const to = Array.isArray(args.to) ? args.to : [args.to];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });

    if (!res.ok) {
      // Resend returns { name, message } on error. Surface the message.
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        if (body?.message) detail = body.message;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, error: detail };
    }

    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
