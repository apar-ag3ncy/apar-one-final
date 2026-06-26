#!/usr/bin/env tsx
/**
 * Dev seed.
 *
 * Idempotent: re-runnable, all inserts gated with WHERE NOT EXISTS.
 *
 * Seeds:
 *   - 1 organization (Apar LLP)
 *   - 3 clients (Lodha, Studio Marigold, Bloom Realty)
 *   - 2 vendors (Studio Lakhotia, Lotus Printers)
 *   - 4 employees (APAR-001..004)
 *   - 3 projects linked to clients (for the §7.2 interconnection scenario)
 *
 * Connects directly via postgres-js to bypass the `server-only` taint on
 * @/lib/db/client. CLAUDE rule #33 still applies in app code; this is a
 * one-off dev script.
 *
 * Usage:  npm run db:seed
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import postgres from 'postgres';

// Tiny .env.local loader — same shape as drizzle.config.ts uses.
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
    // Missing file is fine.
  }
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('[seed] FAIL: DIRECT_URL / DATABASE_URL not set.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

async function ensureOrganization(): Promise<void> {
  await sql`
    INSERT INTO organizations (legal_name, display_name, gstin, pan, registered_address)
    SELECT
      'Apar LLP',
      'Apar',
      '27ABCDE1234F1Z5',
      'ABCDE1234F',
      'Mumbai, Maharashtra'
    WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE legal_name = 'Apar LLP');
  `;
}

async function ensureClients(): Promise<void> {
  for (const name of ['Lodha', 'Studio Marigold', 'Bloom Realty']) {
    await sql`
      INSERT INTO clients (name, status, contract_status, industry)
      SELECT ${name}, 'active', 'signed', ${name === 'Lodha' ? 'Real Estate' : name === 'Studio Marigold' ? 'F&B' : 'Real Estate'}
      WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name = ${name});
    `;
  }
}

async function ensureVendors(): Promise<void> {
  for (const [name, category] of [
    ['Studio Lakhotia', 'photographer'],
    ['Lotus Printers', 'printer'],
  ] as const) {
    await sql`
      INSERT INTO vendors (name, category, status, contract_status)
      SELECT ${name}, ${category}, 'active', 'signed'
      WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = ${name});
    `;
  }
}

async function ensureEmployees(): Promise<void> {
  const roster = [
    ['APAR-001', 'Aakash Singh', 'creative', 'Creative Director'],
    ['APAR-002', 'Riya Patel', 'strategy', 'Account Manager'],
    ['APAR-003', 'Karan Shah', 'growth', 'Growth Lead'],
    ['APAR-004', 'Sneha Iyer', 'operations', 'Ops Coordinator'],
  ] as const;
  for (const [code, fullName, department, designation] of roster) {
    await sql`
      INSERT INTO employees (
        employee_code, full_name, employment_type, status, contract_status,
        joined_on, department, designation
      )
      SELECT
        ${code}, ${fullName}, 'full_time', 'active', 'signed',
        '2026-04-01', ${department}, ${designation}
      WHERE NOT EXISTS (SELECT 1 FROM employees WHERE employee_code = ${code});
    `;
  }
}

async function ensureProjects(): Promise<void> {
  const plan: ReadonlyArray<[name: string, code: string, clientName: string]> = [
    ['Lodha Diwali Campaign', 'LOD-FY26-001', 'Lodha'],
    ['Marigold Packaging Refresh', 'MAR-FY26-002', 'Studio Marigold'],
    ['Bloom Realty Launch Site', 'BLM-FY26-003', 'Bloom Realty'],
  ];
  for (const [name, code, clientName] of plan) {
    await sql`
      INSERT INTO projects (client_id, name, code, status, started_on)
      SELECT c.id, ${name}, ${code}, 'active', '2026-04-15'
      FROM clients c
      WHERE c.name = ${clientName}
        AND NOT EXISTS (SELECT 1 FROM projects WHERE code = ${code});
    `;
  }
}

async function main(): Promise<void> {
  console.log('[seed] starting…');
  try {
    await ensureOrganization();
    console.log('[seed] organization ok');
    await ensureClients();
    console.log('[seed] clients ok');
    await ensureVendors();
    console.log('[seed] vendors ok');
    await ensureEmployees();
    console.log('[seed] employees ok');
    await ensureProjects();
    console.log('[seed] projects ok');
    console.log('[seed] done.');
  } finally {
    await sql.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
