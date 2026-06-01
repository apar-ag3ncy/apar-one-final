import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { env } from '../env';
import type { Database } from './database.types';

/**
 * Next.js middleware Supabase client. Per @supabase/ssr docs: middleware
 * is responsible for *refreshing* the JWT and rotating cookies. Without
 * this, server actions see a stale session.
 *
 * Wire from `middleware.ts` at the project root.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touches the session to trigger refresh if needed.
  await supabase.auth.getUser();

  return response;
}
