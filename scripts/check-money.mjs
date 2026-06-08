#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Pre-commit money-rendering guard (Phase 2 brief).
 *
 *   - Flags `.toFixed(2)` on money — file-size formatters and date math are
 *     allow-listed.
 *   - Flags `value / 100` paise unwrap shortcuts.
 *   - Flags Rule 47 violations inside components/entity/ (next/navigation,
 *     Supabase createClient).
 *
 * The ₹ literal alone is too noisy to catch (form labels, ARIA, copy). The
 * canonical formatter (`components/shared/format-inr.ts`) is the only place
 * the literal is allowed in *output*; everything else should call formatINR.
 *
 * Run: node scripts/check-money.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SRC = join(ROOT, 'src');
const APP = join(SRC, 'app');
const COMPONENTS = join(SRC, 'components');
const ENTITY = join(COMPONENTS, 'entity');

const moneyGlobs = [APP, COMPONENTS];
let errors = 0;

// Files where money-format internals legitimately live.
const FORMAT_ALLOW = new Set([
  'src/components/shared/format-inr.ts',
  'src/components/shared/format-inr.test.ts',
  'src/components/shared/currency-input.tsx',
]);

// `.toFixed(2)` is fine in these contexts (file size, percentages, etc.).
const TO_FIXED_ALLOW = [
  'document-list.tsx', // formatBytes
  'per-client-pnl-table.tsx', // margin %
  'format-inr.ts', // canonical
];

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(path, visit);
    } else if (path.endsWith('.tsx') || path.endsWith('.ts')) {
      visit(path);
    }
  }
}

for (const root of moneyGlobs) {
  walk(root, (file) => {
    const text = readFileSync(file, 'utf8');
    const relWindows = relative(ROOT, file);
    const rel = relWindows.split('\\').join('/');
    if (FORMAT_ALLOW.has(rel)) return;
    text.split('\n').forEach((line, idx) => {
      const trimmed = line.trimStart();
      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return;
      }
      // Skip lines that already use formatINR
      if (line.includes('formatINR') || line.includes('formatPaiseForInput')) return;

      if (
        line.includes('.toFixed(2)') &&
        !TO_FIXED_ALLOW.some((allowed) => rel.endsWith(allowed))
      ) {
        console.error(`MONEY: .toFixed(2) — ${rel}:${idx + 1}\n  ${line.trim()}`);
        errors += 1;
      }
      if (/\bvalue\s*\/\s*100\b/.test(line)) {
        console.error(`MONEY: \`value / 100\` — ${rel}:${idx + 1}\n  ${line.trim()}`);
        errors += 1;
      }
    });
  });
}

// Rule 47 — components/entity/ may not import next/navigation or Supabase.
walk(ENTITY, (file) => {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).split('\\').join('/');
  if (text.includes("from 'next/navigation'") || text.includes('from "next/navigation"')) {
    console.error(`RULE 47: \`next/navigation\` import inside components/entity/ — ${rel}`);
    errors += 1;
  }
  if (text.includes('createClient') && text.includes('@supabase')) {
    console.error(`RULE 47: Supabase \`createClient\` inside components/entity/ — ${rel}`);
    errors += 1;
  }
});

if (errors > 0) {
  console.error(
    `\n${errors} violation${errors === 1 ? '' : 's'}. Fix or whitelist before committing.`,
  );
  process.exit(1);
}
console.log('check-money: OK');
