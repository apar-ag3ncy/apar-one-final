// Full data export — one command.
//
//   DATABASE_URL=postgresql://… node scripts/export-data.mjs
//   (or: npm run db:export, with DATABASE_URL/DIRECT_URL in the environment)
//
// Produces a single timestamped folder under ./exports containing BOTH:
//   • dump.sql        — complete pg_dump of the whole database (restorable)
//   • tables/*.csv     — one Excel-friendly CSV per public table
//
// Requires the Postgres client tools `pg_dump` and `psql` on PATH (they ship
// with any Postgres install / `brew install libpq`). Works against the local
// apar_run DB or a hosted Supabase DB — just point DATABASE_URL at it.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!url) {
  console.error('FAIL: set DATABASE_URL (or DIRECT_URL) before running the export.');
  process.exit(1);
}

function requireTool(tool) {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
  } catch {
    console.error(
      `FAIL: "${tool}" not found on PATH. Install the Postgres client tools ` +
        '(e.g. `brew install libpq` then add it to PATH, or install Postgres).',
    );
    process.exit(1);
  }
}
requireTool('pg_dump');
requireTool('psql');

// Timestamp like 2026-06-08_1530 (local time) for the folder name.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const outDir = resolve(`./exports/apar_${stamp}`);
const tablesDir = resolve(outDir, 'tables');
mkdirSync(tablesDir, { recursive: true });

console.log(`Exporting database → ${outDir}`);

// 1) Full SQL dump (schema + data), portable.
const dumpPath = resolve(outDir, 'dump.sql');
console.log('  • pg_dump → dump.sql …');
execFileSync('pg_dump', [url, '--no-owner', '--no-privileges', '--file', dumpPath], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

// 2) Per-table CSVs.
const tableList = execFileSync(
  'psql',
  [
    url,
    '-At',
    '-c',
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  ],
  { encoding: 'utf8' },
)
  .split('\n')
  .map((t) => t.trim())
  .filter(Boolean);

console.log(`  • ${tableList.length} tables → tables/*.csv …`);
const failures = [];
for (const table of tableList) {
  const csvPath = resolve(tablesDir, `${table}.csv`);
  try {
    execFileSync(
      'psql',
      [
        url,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `\\copy (SELECT * FROM "${table}") TO '${csvPath}' WITH (FORMAT csv, HEADER true)`,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch {
    failures.push(table);
  }
}

console.log('');
console.log(`Done. SQL dump + ${tableList.length - failures.length} CSVs written to:`);
console.log(`  ${outDir}`);
if (failures.length > 0) {
  console.warn(`WARNING: ${failures.length} table(s) failed to export: ${failures.join(', ')}`);
  process.exit(1);
}
