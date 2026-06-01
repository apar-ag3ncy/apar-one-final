// Diagnostic probe — confirms we can reach the configured Postgres, lists
// public-schema tables, and verifies built-ins. Never prints the connection URL.
//
// Run with: node --env-file=.env.local scripts/probe-db.mjs

import postgres from 'postgres';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('FAIL: neither DIRECT_URL nor DATABASE_URL is set.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });

try {
  const [version] = await sql`select version()`;
  console.log('postgres:', version.version.split(',')[0]);

  const [{ uuid }] = await sql`select gen_random_uuid() as uuid`;
  console.log('gen_random_uuid:', uuid);

  const tables = await sql`
    select tablename from pg_catalog.pg_tables
    where schemaname = 'public'
    order by tablename
  `;
  console.log(`public-schema tables: ${tables.length}`);
  for (const t of tables) console.log('  -', t.tablename);

  const types = await sql`
    select typname from pg_catalog.pg_type
    where typnamespace = 'public'::regnamespace and typtype = 'e'
    order by typname
  `;
  console.log(`public-schema enums: ${types.length}`);
  for (const t of types) console.log('  -', t.typname);

  const exts = await sql`
    select extname, extversion from pg_extension order by extname
  `;
  console.log(`installed extensions: ${exts.length}`);
  for (const e of exts) console.log(`  - ${e.extname}@${e.extversion}`);
} catch (err) {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
