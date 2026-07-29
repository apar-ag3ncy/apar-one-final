// One-off migrator using drizzle-orm's postgres-js adapter directly.
// `drizzle-kit migrate` hangs on this Windows shell; this avoids that.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Load .env.local then .env
for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, valueRaw] = match;
      if (!key || !valueRaw) continue;
      const unquoted =
        (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
        (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
          ? valueRaw.slice(1, -1)
          : valueRaw;
      if (file === '.env.local' || !process.env[key]) {
        process.env[key] = unquoted;
      }
    }
  } catch {
    // missing is fine
  }
}

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
