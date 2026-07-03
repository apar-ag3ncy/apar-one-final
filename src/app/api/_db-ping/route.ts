import { NextResponse, type NextRequest } from 'next/server';

// TEMP diagnostic: proves whether a Vercel function can reach the GoDaddy
// cPanel MySQL database. Connects, reports the server version + connection
// limits, and disconnects. Returns NO table data. Token-gated so it can't be
// used as an anonymous DB probe. Delete once the connection is validated.
//
// Requires two Vercel env vars:
//   GODADDY_MYSQL_URL  mysql://user:pass@host:3306/dbname
//   DB_PING_TOKEN      any random string; pass it as ?token=<that>
//
// mysql2 needs the Node.js runtime (not edge) and this must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const expected = process.env.DB_PING_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.GODADDY_MYSQL_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'GODADDY_MYSQL_URL not set' }, { status: 500 });
  }

  const started = Date.now();
  try {
    // Import lazily so a missing driver / non-Node runtime can't break the build.
    const mysql = await import('mysql2/promise');
    const conn = await mysql.createConnection({ uri: url, connectTimeout: 10_000 });
    try {
      const [ver] = (await conn.query('SELECT VERSION() AS version')) as [
        Array<{ version: string }>,
        unknown,
      ];
      const [maxUser] = (await conn.query(
        "SHOW VARIABLES LIKE 'max_user_connections'",
      )) as [Array<{ Variable_name: string; Value: string }>, unknown];
      const [maxConn] = (await conn.query("SHOW VARIABLES LIKE 'max_connections'")) as [
        Array<{ Variable_name: string; Value: string }>,
        unknown,
      ];
      return NextResponse.json({
        ok: true,
        elapsedMs: Date.now() - started,
        version: ver[0]?.version ?? null,
        maxUserConnections: maxUser[0]?.Value ?? null,
        maxConnections: maxConn[0]?.Value ?? null,
      });
    } finally {
      await conn.end();
    }
  } catch (e) {
    const err = e as { message?: string; code?: string; errno?: number };
    return NextResponse.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        error: err.message ?? String(e),
        code: err.code ?? null,
        errno: err.errno ?? null,
      },
      { status: 502 },
    );
  }
}
