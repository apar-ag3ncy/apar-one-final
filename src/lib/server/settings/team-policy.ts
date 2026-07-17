'use server';

import { z } from 'zod';

import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';
import {
  readTeamPolicy,
  writeTeamPolicy,
  type TeamPolicy,
} from '@/lib/server/settings/team-policy-data';

/**
 * Settings → Team policies. 'use server' wrappers over the plain helpers in
 * team-policy-data.ts (same shape as revenue-targets.ts):
 *
 *   - getTeamPolicy  — any signed-in actor (chips, org tree, attendance UI).
 *   - saveTeamPolicy — `manage_company_profile` (the settings-write tier).
 */

export type { TeamPolicy };

export async function getTeamPolicy(): Promise<TeamPolicy> {
  await getActorContext();
  return readTeamPolicy();
}

const RoleListSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(20)
  // Dedup case-insensitively, keeping the first spelling.
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((r) => {
      const k = r.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

const SaveTeamPolicySchema = z.object({
  paidLeavesPerMonth: z.number().int().min(0).max(31),
  teamLeaderRoles: RoleListSchema,
  managerialRoles: RoleListSchema,
});

export type SaveTeamPolicyResult = { ok: true } | { ok: false; message: string };

export async function saveTeamPolicy(input: {
  paidLeavesPerMonth: number;
  teamLeaderRoles: string[];
  managerialRoles: string[];
}): Promise<SaveTeamPolicyResult> {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_company_profile');

  const parsed = SaveTeamPolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        'Check the policy values — leave days must be 0-31 and roles non-empty.',
    };
  }
  if (parsed.data.teamLeaderRoles.length === 0 || parsed.data.managerialRoles.length === 0) {
    return { ok: false, message: 'Keep at least one Team-leader role and one Managerial role.' };
  }

  await writeTeamPolicy(parsed.data, ctx.userId);
  await logAudit({
    actorId: ctx.userId,
    entityType: 'settings',
    entityId: 'team_policy',
    action: 'update',
    changes: {
      paid_leaves_per_month: parsed.data.paidLeavesPerMonth,
      team_leader_roles: parsed.data.teamLeaderRoles,
      managerial_roles: parsed.data.managerialRoles,
    },
  });
  return { ok: true };
}
