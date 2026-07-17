import 'server-only';

import { settings } from '@/lib/db/schema/settings';
import { db } from '@/lib/db/client';

/**
 * Team policy stored in the singleton key/value `settings` table (no
 * migration — the table is generic):
 *
 *   - `paid_leaves_per_month` (valueInt)  — how many days of PAID leave
 *     (earned / casual / sick / comp-off) may be granted to one employee in
 *     a calendar month. Statutory kinds (maternity / paternity) and Unpaid
 *     are never capped. Enforced at leave APPROVAL time.
 *   - `team_leader_roles` (valueJson: string[]) — designations that count
 *     as Team Leader for the TL chip and the org tree.
 *   - `managerial_roles` (valueJson: string[]) — designations that count
 *     as Manager.
 *
 * Plain (non-action) helpers — the 'use server' wrappers in
 * settings/team-policy.ts add the capability gate for UI callers (same
 * shape as app-settings.ts / revenue-targets.ts).
 */

const KEY_PAID_LEAVES_PER_MONTH = 'paid_leaves_per_month';
const KEY_TEAM_LEADER_ROLES = 'team_leader_roles';
const KEY_MANAGERIAL_ROLES = 'managerial_roles';

export type TeamPolicy = {
  /** Paid-leave days grantable per employee per calendar month. */
  paidLeavesPerMonth: number;
  teamLeaderRoles: string[];
  managerialRoles: string[];
};

export const TEAM_POLICY_DEFAULTS: TeamPolicy = {
  paidLeavesPerMonth: 1,
  teamLeaderRoles: ['Team Leader', 'TL'],
  managerialRoles: ['Manager'],
};

function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export async function readTeamPolicy(): Promise<TeamPolicy> {
  const rows = await db
    .select({ key: settings.key, valueInt: settings.valueInt, valueJson: settings.valueJson })
    .from(settings);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const paid = byKey.get(KEY_PAID_LEAVES_PER_MONTH)?.valueInt;
  return {
    paidLeavesPerMonth:
      typeof paid === 'number' && paid >= 0 ? paid : TEAM_POLICY_DEFAULTS.paidLeavesPerMonth,
    teamLeaderRoles: asStringList(
      byKey.get(KEY_TEAM_LEADER_ROLES)?.valueJson,
      TEAM_POLICY_DEFAULTS.teamLeaderRoles,
    ),
    managerialRoles: asStringList(
      byKey.get(KEY_MANAGERIAL_ROLES)?.valueJson,
      TEAM_POLICY_DEFAULTS.managerialRoles,
    ),
  };
}

async function upsertSetting(
  key: string,
  patch: { valueInt?: number | null; valueJson?: unknown; description: string },
  actorId: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      valueInt: patch.valueInt ?? null,
      valueJson: patch.valueJson ?? null,
      description: patch.description,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        valueInt: patch.valueInt ?? null,
        valueJson: patch.valueJson ?? null,
        updatedBy: actorId,
        updatedAt: new Date(),
      },
    });
}

export async function writeTeamPolicy(policy: TeamPolicy, actorId: string): Promise<void> {
  await upsertSetting(
    KEY_PAID_LEAVES_PER_MONTH,
    {
      valueInt: policy.paidLeavesPerMonth,
      description:
        'Paid-leave days (earned/casual/sick/comp-off) grantable per employee per calendar month.',
    },
    actorId,
  );
  await upsertSetting(
    KEY_TEAM_LEADER_ROLES,
    {
      valueJson: policy.teamLeaderRoles,
      description: 'Designations that count as Team Leader (TL chip + org tree).',
    },
    actorId,
  );
  await upsertSetting(
    KEY_MANAGERIAL_ROLES,
    {
      valueJson: policy.managerialRoles,
      description: 'Designations that count as Manager (chip + org tree).',
    },
    actorId,
  );
}
