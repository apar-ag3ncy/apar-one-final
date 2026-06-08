#!/usr/bin/env tsx
/**
 * `db:check` — fails CI on any float / numeric / real / double-precision
 * column in a Drizzle migration SQL file. CLAUDE.md rule #1 + LEDGER-SPEC
 * §0.4: money is `bigint` paise; nothing else.
 *
 * Scope: every `*.sql` file under `drizzle/` (the migration output). We
 * deliberately do NOT scan the TS schema files — Drizzle's `numeric()`
 * column builder maps to PG `numeric`, which is what we want to ban, and
 * the SQL is the ground truth.
 *
 * Forbidden tokens (PG type names that store fractional / floating numbers):
 *   - `numeric`
 *   - `decimal`
 *   - `real`
 *   - `double precision`
 *   - `float` (alias for `real` / `double precision` depending on size)
 *
 * Allowed (and ignored):
 *   - `bigint`, `int`, `smallint`, `serial`
 *   - Comments — single-line `--` and block `/\* *\/`
 *   - Identifier matches inside quoted strings (e.g. column names) —
 *     ignored.
 *
 * Exit codes: 0 on clean, 1 on any finding.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle');

// Match a PG type keyword that appears as a column-type position:
//   <ws>(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT(N))<ws or ( or , or end>
// Case-insensitive. The `\b` boundaries guard against `int4numeric_foo`.
const FORBIDDEN = /\b(numeric|decimal|real|double\s+precision|float(?:\s*\(\d+\))?)\b/gi;

type Finding = {
  file: string;
  line: number;
  column: number;
  token: string;
  text: string;
};

/** Strip SQL comments (line + block) and string literals from a single line.
 *  Crude — assumes no multi-line literals (true for Drizzle output). */
function strip(line: string): string {
  // Line comment first (handles trailing comment on a SQL line).
  const dashIdx = line.indexOf('--');
  let body = dashIdx >= 0 ? line.slice(0, dashIdx) : line;

  // String literals (single-quoted; double-quoted are identifiers in PG).
  body = body.replace(/'[^']*'/g, "''");

  return body;
}

/** Block-comment stripper. Drizzle output sometimes wraps headers in /\* *\/.
 *  Operate on the full file string; replace block-comment content with spaces
 *  preserving line breaks so line numbers stay aligned. */
function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

async function findSqlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      out.push(...(await findSqlFiles(path)));
    } else if (stats.isFile() && name.endsWith('.sql')) {
      out.push(path);
    }
  }
  return out;
}

async function scanFile(path: string): Promise<Finding[]> {
  const raw = await readFile(path, 'utf8');
  const src = stripBlockComments(raw);
  const findings: Finding[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const body = strip(rawLine);
    FORBIDDEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FORBIDDEN.exec(body)) !== null) {
      findings.push({
        file: path,
        line: i + 1,
        column: m.index + 1,
        token: m[0],
        text: rawLine.trim(),
      });
    }
  }
  return findings;
}

async function main(): Promise<void> {
  const files = await findSqlFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    // No migrations yet; that's fine for a fresh repo.
    console.log(`[db:check] no SQL migrations under ${MIGRATIONS_DIR} — ok.`);
    return;
  }
  const findings: Finding[] = [];
  for (const file of files) {
    findings.push(...(await scanFile(file)));
  }
  if (findings.length === 0) {
    console.log(
      `[db:check] scanned ${files.length} migration(s) — no float/numeric/real/double precision/float columns. ok.`,
    );
    return;
  }
  console.error(
    `[db:check] ✗ found ${findings.length} forbidden column type(s). Money is bigint paise (CLAUDE.md rule #1).\n`,
  );
  for (const f of findings) {
    const rel = relative(process.cwd(), f.file);
    console.error(`  ${rel}:${f.line}:${f.column}  "${f.token}"`);
    console.error(`    > ${f.text}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('[db:check] crashed:', err);
  process.exitCode = 1;
});
