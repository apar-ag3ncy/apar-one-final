// One-off migrator using drizzle-orm's postgres-js adapter directly.
// `drizzle-kit migrate` hangs on this Windows shell; this avoids that.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('FAIL: DIRECT_URL / DATABASE_URL not set.');
  process.exit(1);
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client);

console.log('running migrations from ./drizzle …');
await migrate(db, { migrationsFolder: resolve('./drizzle') });
console.log('done.');

await client.end();
