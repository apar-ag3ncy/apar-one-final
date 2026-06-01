import 'server-only';

import { AppError } from './errors';
import {
  type Capability,
  CAPABILITY_SET,
  type CurrentUserContext,
  type Role,
  loadCapabilities,
} from './rbac';
import { createClient } from './supabase/server';

const VALID_ROLES: ReadonlySet<Role> = new Set<Role>([
  'partner',
  'admin',
  'manager',
  'accountant',
  'employee',
  'viewer',
]);

/**
 * Resolve the current request's authenticated user.
 *
 *   - Reads the auth session from cookies via the SSR client.
 *   - Looks up the matching `public.users` row to get role + display info.
 *   - Loads the role's capability set.
 *
 * Throws `unauthenticated` if no session, or `internal` if the auth user
 * exists but no matching `public.users` row (the auth.users → public.users
 * sync trigger should always populate this — its absence indicates the
 * trigger is broken, not that we should treat the user as anonymous).
 *
 * Called by every server action at the top. Cache the result via React's
 * `cache()` helper in `app/_currentUser.ts` (Phase 3+ frontend wiring).
 */
export async function currentUser(): Promise<CurrentUserContext> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    throw new AppError('unauthenticated', 'No active session.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError) {
    throw new AppError('internal', 'Failed to load user profile.', {
      cause: profileError,
    });
  }
  if (!profile) {
    throw new AppError(
      'internal',
      'No public.users row for this auth user. The handle_new_user trigger may be misconfigured.',
      { detail: { authUserId: authUser.id } },
    );
  }

  const role = profile.role as Role;
  if (!VALID_ROLES.has(role)) {
    throw new AppError('internal', `Unknown role "${role}" on user profile.`);
  }

  const capabilities = await loadCapabilities(supabase, role);

  return {
    userId: profile.id as string,
    role,
    capabilities,
  };
}

/**
 * Returns the current user if a session exists, otherwise null. For
 * surfaces that should degrade gracefully (e.g., public pages, the
 * login form).
 */
export async function maybeCurrentUser(): Promise<CurrentUserContext | null> {
  try {
    return await currentUser();
  } catch (err) {
    if (err instanceof AppError && err.kind === 'unauthenticated') {
      return null;
    }
    throw err;
  }
}

export type { Capability, CurrentUserContext, Role };
export { CAPABILITY_SET };
