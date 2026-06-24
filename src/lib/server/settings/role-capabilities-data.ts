import 'server-only';

import { db } from '@/lib/db/client';
import { roleCapabilities } from '@/lib/db/schema';
import { CAPABILITIES, CAPABILITY_SET, ROLES, type Capability, type Role } from '@/lib/rbac';

/**
 * Pure read helper for Settings → Roles. Kept OUT of the `'use server'`
 * action module (role-capabilities.ts) so the server page can import it
 * directly without the action-serialization boundary. Capability gating
 * lives in the action wrappers and the page; this is an unguarded read.
 */

/** Wire shape for the matrix — arrays (not Sets) so it serializes cleanly. */
export type RoleCapabilityGrants = Record<Role, Capability[]>;

export async function loadRoleCapabilityGrants(): Promise<RoleCapabilityGrants> {
  const rows = await db
    .select({
      role: roleCapabilities.role,
      capability: roleCapabilities.capability,
      granted: roleCapabilities.granted,
    })
    .from(roleCapabilities);

  const grants = Object.fromEntries(
    ROLES.map((role) => [role, [] as Capability[]]),
  ) as RoleCapabilityGrants;

  // Partner always has everything — rbac short-circuits, the seed keeps the
  // rows granted, and the UI locks the column. Render from code, not the DB,
  // so a stale seed can never show partner as missing a capability.
  grants.partner = [...CAPABILITIES];

  for (const row of rows) {
    if (row.role === 'partner' || !row.granted) continue;
    // Stray rows with codes not in the closed enum are silently ignored,
    // mirroring loadCapabilities() in lib/rbac.ts.
    if (!CAPABILITY_SET.has(row.capability as Capability)) continue;
    grants[row.role].push(row.capability as Capability);
  }

  return grants;
}
