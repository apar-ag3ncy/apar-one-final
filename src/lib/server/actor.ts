import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { CAPABILITY_SET, type Capability, type CurrentUserContext, type Role } from '@/lib/rbac';
import { maybeCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { employees, osUsers, roleCapabilities } from '@/lib/db/schema';
import { readOsSessionUserId } from '@/lib/server/os-session';

/**
 * Resolve the actor for a server action, in priority order:
 *
 *   1. A real Supabase Auth session (`currentUser()`).
 *   2. The OS session (`apar_os_uid`) — the login that actually works today:
 *        - an EMPLOYEE portal account (os_users.employee_id set) resolves to a
 *          least-privileged `employee` context;
 *        - a STAFF/OS account resolves to full capabilities, exactly matching
 *          the behaviour those users have today.
 *   3. The dev-admin fallback (see below).
 *   4. Otherwise: unauthenticated.
 *
 * ── The dev-admin fallback ──────────────────────────────────────────────────
 * Historically this returned a FULL-capability admin for anyone with no
 * session, and the switch is opt-OUT (`ALLOW_DEV_ADMIN !== 'false'`), so an
 * anonymous caller could invoke any server action as an admin — server actions
 * are plain HTTP POSTs, so the UI never gated this.
 *
 * Step 2 is what makes closing that hole possible. The fallback is deliberately
 * left in place here so this change is backward-compatible on its own; it is
 * closed by setting `ALLOW_DEV_ADMIN='false'` on the deployment, which is safe
 * only once OS/portal logins are in use (they now are, via step 2).
 *
 * NOTE: the employee portal does NOT rely on this function for identity — see
 * `server/portal/session.ts`, which never falls back to anything.
 */

/**
 * Sentinel `users.id` used as the actor id for OS-authenticated requests.
 *
 * `os_users.id` is TEXT ('super-admin' / 'u-<hex>') and can never be written to
 * a uuid actor column (`created_by`, `posted_by`, `audit_log.actor_id`, …), and
 * there is no `users` row per OS account. Reusing the existing sentinel keeps
 * attribution continuous with every row already written this way.
 *
 * Portal writes additionally record the REAL actor as an employee uuid in
 * purpose-built columns (e.g. `leaves.decided_by_employee_id`).
 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// Whether the sentinel user row has been ensured in this server process.
// Reset on every cold start; cheap one-shot upsert per process. Without this,
// transactions.posted_by (and any other column that FK's to users.id) blows up
// when the sentinel id is handed to a fresh / un-migrated DB.
let systemUserEnsured = false;

async function ensureSystemUser(): Promise<void> {
  if (systemUserEnsured) return;
  try {
    await db.execute(sql`
      INSERT INTO "users" (id, role, full_name, email)
      VALUES (
        ${SYSTEM_USER_ID},
        'admin',
        'Dev Admin (system)',
        'dev-admin@apar.local'
      )
      ON CONFLICT (id) DO NOTHING
    `);
    systemUserEnsured = true;
  } catch {
    // Best-effort: if the upsert itself fails (network blip, RLS in some
    // future config), still mark ensured so we don't hammer it on every
    // call. The downstream FK violation will surface a clear message.
    systemUserEnsured = true;
  }
}

/** Capabilities granted to a role, read from the live role_capabilities table. */
async function capabilitiesForRole(role: Role): Promise<ReadonlySet<Capability>> {
  const rows = await db
    .select({ capability: roleCapabilities.capability, granted: roleCapabilities.granted })
    .from(roleCapabilities)
    .where(eq(roleCapabilities.role, role));

  const granted = new Set<Capability>();
  for (const row of rows) {
    if (row.granted && CAPABILITY_SET.has(row.capability as Capability)) {
      granted.add(row.capability as Capability);
    }
  }
  return granted;
}

/**
 * Resolve an actor from the OS session cookie, or null when there isn't a
 * usable one.
 *
 * Security-critical branch: an account WITH an employee link that no longer
 * resolves to a live, active employee returns null — it must never fall through
 * to the staff branch, which would hand a separated employee full capabilities.
 */
async function resolveOsActor(): Promise<CurrentUserContext | null> {
  const osUserId = await readOsSessionUserId();
  if (!osUserId) return null;

  const [row] = await db
    .select({
      role: osUsers.role,
      employeeId: osUsers.employeeId,
      employeeStatus: employees.status,
      employeeArchived: employees.isArchived,
      employeeDeletedAt: employees.deletedAt,
    })
    .from(osUsers)
    .leftJoin(employees, eq(employees.id, osUsers.employeeId))
    .where(and(eq(osUsers.id, osUserId), isNull(osUsers.deletedAt)))
    .limit(1);

  if (!row) return null;

  // Staff status comes from the ACCOUNT'S ROLE, not from whether it happens to
  // be linked to an employee. An admin is also a person on the payroll, and
  // linking their account to their employee record (so they get a portal
  // profile and appear in the directory) must not strip their OS rights.
  // Portal accounts are created with role 'user', so they never land here.
  if (row.role === 'super_admin' || row.role === 'admin') {
    await ensureSystemUser();
    return {
      userId: SYSTEM_USER_ID,
      role: 'admin',
      capabilities: CAPABILITY_SET,
    };
  }

  if (row.employeeId) {
    // Employee portal account — least privilege.
    const stillEmployed =
      row.employeeDeletedAt === null &&
      row.employeeArchived === false &&
      row.employeeStatus !== 'separated';
    if (!stillEmployed) return null;

    await ensureSystemUser();
    return {
      userId: SYSTEM_USER_ID,
      role: 'employee',
      capabilities: await capabilitiesForRole('employee'),
    };
  }

  // An OS account with role 'user' and no employee link — a staff seat with no
  // portal identity. Unchanged behaviour: full capabilities, gated in the OS UI
  // by the client-side `can()` permission map.
  await ensureSystemUser();
  return {
    userId: SYSTEM_USER_ID,
    role: 'admin',
    capabilities: CAPABILITY_SET,
  };
}

export async function getActorContext(): Promise<CurrentUserContext> {
  const real = await maybeCurrentUser();
  if (real) return real;

  // Defensive: this runs on EVERY server action. A transient DB error while
  // resolving the session must not 500 the entire app — fall through to the
  // pre-existing behaviour instead. A failure here can only ever cost
  // privilege (the fallback below is itself gated by ALLOW_DEV_ADMIN), never
  // grant it beyond what the deployment already allows.
  let osActor: CurrentUserContext | null = null;
  try {
    osActor = await resolveOsActor();
  } catch {
    osActor = null;
  }
  if (osActor) return osActor;

  // Opt-OUT dev fallback — see the file header. Set ALLOW_DEV_ADMIN='false' on
  // the deployment to require a real session everywhere.
  const allowDevAdmin = process.env.ALLOW_DEV_ADMIN !== 'false';
  if (allowDevAdmin) {
    await ensureSystemUser();
    return {
      userId: SYSTEM_USER_ID,
      role: 'admin',
      capabilities: CAPABILITY_SET,
    };
  }

  throw new (await import('@/lib/errors')).AppError('unauthenticated', 'No active session.');
}
