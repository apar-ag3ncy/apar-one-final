import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './database.types';

/**
 * Browser / Client Component Supabase client. Uses the anon key. Reads
 * the session from cookies. CLAUDE rule #32: NEVER use the service-role
 * key here.
 *
 * Module-level cached. Each Next.js page that uses this gets the same
 * instance, so realtime subscriptions don't multiply.
 */
let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (cachedClient) return cachedClient;
  cachedClient = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cachedClient;
}
