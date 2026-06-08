'use server';

import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import { sendActivityDigest } from '@/lib/server/activity/digest';
import { emailConfigError, isEmailConfigured } from '@/lib/server/email/send';
import {
  readActivityDigestConfig,
  writeActivityDigestConfig,
} from '@/lib/server/settings/app-settings';

/**
 * UI-facing actions for the Settings → Notifications "daily activity digest".
 * Gated on `manage_billing_settings` (admin-tier org config). The cron route
 * uses the plain helpers in settings/app-settings.ts + activity/digest.ts
 * directly (no user session).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// audit_log.entity_id is a uuid column, but the digest config isn't a row with
// a single id (it's two settings keys). Use a fixed synthetic uuid so the
// attributable audit rows group together under one logical entity.
const DIGEST_ENTITY_ID = '0d160000-0000-0000-0000-000000000000';

export type ActivityDigestConfigView = {
  enabled: boolean;
  recipient: string;
  /** Whether the Gmail/Workspace sender is configured in the environment. */
  emailReady: boolean;
  /** Human-readable reason the provider isn't ready, if any. */
  emailError: string | null;
};

export async function getActivityDigestConfig(): Promise<ActivityDigestConfigView> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_billing_settings');
  const cfg = await readActivityDigestConfig();
  return {
    enabled: cfg.enabled,
    recipient: cfg.recipient ?? '',
    emailReady: isEmailConfigured(),
    emailError: emailConfigError(),
  };
}

const SaveSchema = z.object({
  enabled: z.boolean(),
  recipient: z.string().trim().max(200),
});

export type SaveDigestResult =
  | { ok: true }
  | { ok: false; message: string; errors: Record<string, string> };

export async function saveActivityDigestConfig(input: {
  enabled: boolean;
  recipient: string;
}): Promise<SaveDigestResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_billing_settings');

  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: 'Please fix the highlighted fields.', errors: {} };
  }
  const { enabled, recipient } = parsed.data;

  // A recipient is required to enable the digest, and must look like an email.
  if (enabled && !recipient) {
    return {
      ok: false,
      message: 'Add a recipient email before enabling the digest.',
      errors: { recipient: 'Recipient is required.' },
    };
  }
  if (recipient && !EMAIL_RE.test(recipient)) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      errors: { recipient: 'Enter a valid email address.' },
    };
  }

  await writeActivityDigestConfig({ enabled, recipient: recipient || null }, ctx.userId);
  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: DIGEST_ENTITY_ID,
    action: 'update',
    changes: { enabled: { after: enabled }, recipient: { after: recipient || null } },
  });
  return { ok: true };
}

export type SendDigestNowResult = { ok: true; count: number } | { ok: false; message: string };

/** Send the digest immediately to the saved recipient (the "send test" button). */
export async function sendActivityDigestNow(): Promise<SendDigestNowResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_billing_settings');

  const cfg = await readActivityDigestConfig();
  if (!cfg.recipient) {
    return { ok: false, message: 'Set and save a recipient email first.' };
  }
  const result = await sendActivityDigest({ to: cfg.recipient, sinceHours: 24 });
  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: DIGEST_ENTITY_ID,
    action: 'update',
    changes: { sentTestDigest: { to: cfg.recipient, events: result.count } },
  });
  return { ok: true, count: result.count };
}
