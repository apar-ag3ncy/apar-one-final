import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function serializeError(e: unknown): unknown {
  if (e instanceof Error) {
    const anyE = e as Error & { code?: unknown; digest?: unknown; cause?: unknown };
    return {
      name: e.name,
      message: e.message,
      code: anyE.code,
      digest: anyE.digest,
      stack: e.stack?.split('\n').slice(0, 20),
      cause: anyE.cause ? serializeError(anyE.cause) : undefined,
    };
  }
  return { value: String(e) };
}

export async function GET() {
  const out: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    envCheck: {
      DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
      DATABASE_URL_first50: process.env.DATABASE_URL?.substring(0, 50),
      DATABASE_URL_has_pgbouncer: process.env.DATABASE_URL?.includes('pgbouncer'),
      DATABASE_URL_port: process.env.DATABASE_URL?.match(/:(\d{4,5})\//)?.[1],
      DIRECT_URL_set: Boolean(process.env.DIRECT_URL),
      DIRECT_URL_first50: process.env.DIRECT_URL?.substring(0, 50),
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY_set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY_set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      APP_URL: process.env.APP_URL,
      ALLOW_DEV_ADMIN: process.env.ALLOW_DEV_ADMIN,
    },
  };

  // 1) Raw postgres connection (bypasses drizzle/schemas)
  try {
    const postgres = (await import('postgres')).default;
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
    const rows = await sql`SELECT 1 AS ok, current_database() AS db, current_user AS usr`;
    out.dbRawConnect = { ok: true, result: rows[0] };
    await sql.end({ timeout: 5 });
  } catch (e) {
    out.dbRawConnect = { ok: false, error: serializeError(e) };
  }

  // 2) Drizzle client (uses the same module the app uses)
  try {
    const { db } = await import('@/lib/db/client');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`SELECT 1 AS ok`);
    out.drizzleConnect = { ok: true, rowsType: typeof res, sample: res };
  } catch (e) {
    out.drizzleConnect = { ok: false, error: serializeError(e) };
  }

  // 3) Confirm key tables exist
  try {
    const { db } = await import('@/lib/db/client');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('clients', 'vendors', 'employees', 'users')
      ORDER BY table_name
    `);
    out.tablesPresent = { ok: true, tables: res };
  } catch (e) {
    out.tablesPresent = { ok: false, error: serializeError(e) };
  }

  // 4) Row counts (bypassing RLS only if using service role; otherwise reflects RLS)
  try {
    const { db } = await import('@/lib/db/client');
    const { sql } = await import('drizzle-orm');
    const res = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM public.clients)::int AS clients,
        (SELECT COUNT(*) FROM public.vendors)::int AS vendors,
        (SELECT COUNT(*) FROM public.employees)::int AS employees,
        (SELECT COUNT(*) FROM public.users)::int AS users
    `);
    out.rowCounts = { ok: true, counts: res };
  } catch (e) {
    out.rowCounts = { ok: false, error: serializeError(e) };
  }

  // 5) getActorContext (exercises the auth gate / dev-admin fallback)
  try {
    const { getActorContext } = await import('@/lib/server/actor');
    const actor = await getActorContext();
    out.actor = { ok: true, role: actor.role, userId: actor.userId, capCount: actor.capabilities.size };
  } catch (e) {
    out.actor = { ok: false, error: serializeError(e) };
  }

  // 6) listClients (what the /clients page actually calls)
  try {
    const mod = await import('@/lib/server-stub/entity-actions');
    const clients = await mod.listClients();
    out.listClients = { ok: true, count: clients.length, sample: clients.slice(0, 1) };
  } catch (e) {
    out.listClients = { ok: false, error: serializeError(e) };
  }

  return NextResponse.json(out, { status: 200 });
}
