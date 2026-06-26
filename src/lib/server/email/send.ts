import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Transactional email sender — sends through a Google / Google Workspace
 * account over SMTP (smtp.gmail.com). This is the real implementation behind
 * the app's `SendEmailFn` seam (lib/server/billing/reminders.ts) and the
 * activity digest.
 *
 * Configuration (set in `.env.local`, never committed):
 *   GMAIL_USER          — the full Google/Workspace address that sends
 *                         (e.g. you@your-workspace-domain.com)
 *   GMAIL_APP_PASSWORD  — a 16-char Google "App Password" (NOT your login
 *                         password). Requires 2-Step Verification enabled on
 *                         the account; Workspace admins must allow App
 *                         Passwords. Generate at:
 *                         https://myaccount.google.com/apppasswords
 *   EMAIL_FROM_NAME     — optional display name, e.g. "Apar One". The address
 *                         is always GMAIL_USER (Gmail rewrites mismatched From).
 *
 * Returns a discriminated result so callers can log/report failures without
 * throwing. Never logs the password.
 */

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

function credentials(): { user?: string; pass?: string } {
  return { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD };
}

/** True when the sender is configured enough to attempt a send. */
export function isEmailConfigured(): boolean {
  const { user, pass } = credentials();
  return Boolean(user && pass);
}

/** Human-readable reason the sender isn't ready (for surfacing in the UI). */
export function emailConfigError(): string | null {
  const { user, pass } = credentials();
  const missing: string[] = [];
  if (!user) missing.push('GMAIL_USER');
  if (!pass) missing.push('GMAIL_APP_PASSWORD');
  return missing.length > 0 ? `Email is not configured — set ${missing.join(' and ')}.` : null;
}

let transporter: Transporter | null = null;
function getTransporter(user: string, pass: string): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const configError = emailConfigError();
  if (configError) return { ok: false, error: configError };

  const { user, pass } = credentials();
  const displayName = process.env.EMAIL_FROM_NAME?.trim();
  const from = displayName ? `${displayName} <${user}>` : user!;
  const to = Array.isArray(args.to) ? args.to.join(', ') : args.to;

  try {
    const info = await getTransporter(user!, pass!).sendMail({
      from,
      to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
