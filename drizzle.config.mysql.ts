import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

// Minimal .env.local loader (mirrors drizzle.config.ts) so drizzle-kit sees
// GODADDY_MYSQL_URL without an extra dep. Existing process env wins.
for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, valueRaw] = match;
      if (key === undefined || valueRaw === undefined) continue;
      if (process.env[key] !== undefined && process.env[key] !== '') continue;
      const unquoted =
        (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
        (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
          ? valueRaw.slice(1, -1)
          : valueRaw;
      process.env[key] = unquoted;
    }
  } catch {
    // Missing file is fine (CI).
  }
}

// The MariaDB port of the schema (Stage 1). Kept in a parallel dir while the
// Postgres schema still drives prod; the two do not mix at runtime.
export default defineConfig({
  dialect: 'mysql',
  schema: './src/lib/db/schema-mysql/*.ts',
  out: './drizzle-mysql',
  dbCredentials: { url: process.env.GODADDY_MYSQL_URL ?? '' },
  strict: true,
  verbose: true,
  casing: 'snake_case',
});
