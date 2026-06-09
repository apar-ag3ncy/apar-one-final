import 'server-only';

import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema/settings';

/**
 * Org-wide app settings stored in the singleton key/value `settings` table.
 * Plain (non-action) helpers so the cron job can read config without a user
 * session; the 'use server' wrappers in entities/activity-digest.ts add the
 * capability gate for UI callers.
 */

const KEY_DIGEST_ENABLED = 'activity_digest_enabled';
const KEY_DIGEST_RECIPIENT = 'activity_digest_recipient';

export type ActivityDigestConfig = {
  enabled: boolean;
  recipient: string | null;
};

export async function readActivityDigestConfig(): Promise<ActivityDigestConfig> {
  const rows = await db
    .select({ key: settings.key, valueBool: settings.valueBool, valueText: settings.valueText })
    .from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    enabled: byKey.get(KEY_DIGEST_ENABLED)?.valueBool ?? false,
    recipient: byKey.get(KEY_DIGEST_RECIPIENT)?.valueText ?? null,
  };
}

async function upsertSetting(
  key: string,
  patch: { valueBool?: boolean | null; valueText?: string | null; description: string },
  actorId: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      valueBool: patch.valueBool ?? null,
      valueText: patch.valueText ?? null,
      description: patch.description,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueBool: patch.valueBool ?? null,
        valueText: patch.valueText ?? null,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
    });
}

export async function writeActivityDigestConfig(
  cfg: ActivityDigestConfig,
  actorId: string,
): Promise<void> {
  await upsertSetting(
    KEY_DIGEST_ENABLED,
    { valueBool: cfg.enabled, description: 'Send the daily activity digest email.' },
    actorId,
  );
  await upsertSetting(
    KEY_DIGEST_RECIPIENT,
    {
      valueText: cfg.recipient,
      description: 'Recipient address for the daily activity digest email.',
    },
    actorId,
  );
}
