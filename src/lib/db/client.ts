import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy apar-dashboard/.env.example to .env.local and fill it in.',
  );
}

// Singleton across hot reloads in dev. Next.js can re-evaluate this module
// many times; without a global cache we'd leak postgres connection pools.
const globalForDb = globalThis as unknown as {
  __aparPostgres?: ReturnType<typeof postgres>;
};

const connection =
  globalForDb.__aparPostgres ??
  postgres(databaseUrl, {
    prepare: false, // Supabase pgbouncer (transaction mode) requires this.
    max: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__aparPostgres = connection;
}

export const db = drizzle(connection, { schema, casing: 'snake_case' });

export type DbClient = typeof db;
