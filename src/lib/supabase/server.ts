import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '../env';
import type { Database } from './database.types';

/**
 * Server Component / Server Action / Route Handler Supabase client.
 *
 * Uses the **anon** key + cookie-bound session — respects RLS as the
 * logged-in user. Never uses the service-role key from this function
 * (CLAUDE rule #32 + #33).
 *
 * Cookies are read/written via Next's `cookies()` helper; @supabase/ssr's
 * `getAll` / `setAll` API replaces the older single-cookie one.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies — middleware handles refresh.
          }
        },
      },
    },
  );
}

/**
 * Service-role admin client. SERVER-ONLY. Bypasses RLS. Use only when
 * the operation legitimately needs to act outside the caller's row-level
 * scope — sync triggers, admin scripts, and (sparingly) post-validated
 * background jobs.
 *
 * **Do not** import this from a Server Component or Server Action that
 * runs on behalf of a user. Use `createClient()` instead, which respects
 * RLS.
 */
export function createAdminClient() {
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      // Service role doesn't use the user's session.
      getAll: () => [],
      setAll: () => {},
    },
  });
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
export type { Database };
