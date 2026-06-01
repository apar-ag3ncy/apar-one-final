import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

// Minimal .env.local loader — keeps drizzle-kit dep-free. Loads .env.local
// then falls back to .env. Existing process env wins.
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
    // File doesn't exist — that's fine for envs like CI.
  }
}

// `db:generate` reads schema files only and does not connect.
// `db:migrate` / `db:studio` need a real DIRECT_URL — they fail loudly if it's missing.
const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: { url: directUrl },
  strict: true,
  verbose: true,
  casing: 'snake_case',
});
