import 'server-only';

import { sql } from 'drizzle-orm';

import { CAPABILITY_SET, type CurrentUserContext } from '@/lib/rbac';
import { maybeCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db/client';

/**
 * Server actions call this at the top to get an actor context. Until the
 * Supabase Auth UI is wired up (P1.11 consumer), we fall back to a dev
 * "admin" context with full capabilities so the rest of the system is
 * exercisable end-to-end. In production this MUST be replaced with strict
 * `currentUser()` — see TODO below.
 *
 * Once the login flow + middleware land, delete this file and have every
 * server action call `currentUser()` from `@/lib/auth` directly.
 */

const DEV_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000000';

// Whether the dev admin row has been ensured in this server process.
// Reset on every cold start; cheap one-shot upsert per process. Without
// this, transactions.posted_by (and any other column that FK's to
// users.id) blows up when the dev fallback hands the sentinel id to a
// fresh / un-migrated DB.
let devAdminEnsured = false;

async function ensureDevAdmin(): Promise<void> {
  if (devAdminEnsured) return;
  try {
    await db.execute(sql`
      INSERT INTO "users" (id, role, full_name, email)
      VALUES (
        ${DEV_ADMIN_USER_ID},
        'admin',
        'Dev Admin (system)',
        'dev-admin@apar.local'
      )
      ON CONFLICT (id) DO NOTHING
    `);
    devAdminEnsured = true;
  } catch {
    // Best-effort: if the upsert itself fails (network blip, RLS in some
    // future config), still mark ensured so we don't hammer it on every
    // call. The downstream FK violation will surface a clear message.
    devAdminEnsured = true;
  }
}

export async function getActorContext(): Promise<CurrentUserContext> {
  const real = await maybeCurrentUser();
  if (real) return real;

  // TODO(human): remove this dev fallback once Supabase Auth UI is wired.
  // The fallback returns a fully-capable admin context so server actions
  // remain exercisable from the dev browser session that does not yet
  // carry a real auth cookie.
  //
  // In production the fallback is OFF by default. Set ALLOW_DEV_ADMIN=true
  // on the deployment to opt-in (e.g. internal demo of apar-one-final
  // before the Supabase Auth login flow is wired up). Anyone hitting the
  // app gets admin capabilities, so only enable on private deployments.
  const allowDevAdmin =
    process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_ADMIN === 'true';

  if (allowDevAdmin) {
    // Self-heal: if migration 0014 hasn't been applied for any reason
    // (fresh clone, devs forgot npm run db:migrate), insert the sentinel
    // user row on-demand so transactions.posted_by FKs resolve.
    await ensureDevAdmin();
    return {
      userId: DEV_ADMIN_USER_ID,
      role: 'admin',
      capabilities: CAPABILITY_SET,
    };
  }

  // In production, require a real session.
  throw new (await import('@/lib/errors')).AppError('unauthenticated', 'No active session.');
}
