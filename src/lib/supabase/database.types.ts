/**
 * Database typings stub for `@supabase/supabase-js` generics.
 *
 * Real shape comes from `npx supabase gen types typescript --project-id
 * <ref>` — that's a follow-up devops task. For now, this is `any` so the
 * server-side client type-checks; we get strong typing from Drizzle for
 * direct SQL via `lib/db/client.ts`, and Supabase auth APIs work without
 * the schema being typed.
 *
 * When `gen types` runs, replace this file with the generated output.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
