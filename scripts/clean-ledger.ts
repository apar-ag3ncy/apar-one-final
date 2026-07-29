#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('FAIL: DATABASE_URL not set.');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  console.log('[clean-ledger] Neutralizing ledger delete triggers...');
  await sql`
    CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $$
    BEGIN
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `;

  console.log('[clean-ledger] Deleting all postings...');
  const res1 = await sql`DELETE FROM postings;`;
  console.log('[clean-ledger] Deleted postings:', res1.count);

  console.log('[clean-ledger] Deleting all transactions...');
  const res2 = await sql`DELETE FROM transactions;`;
  console.log('[clean-ledger] Deleted transactions:', res2.count);

  console.log('[clean-ledger] Restoring ledger delete triggers...');
  await sql`
    CREATE OR REPLACE FUNCTION public.tg_block_delete_ledger() RETURNS TRIGGER AS $$
    DECLARE
      v_status text;
    BEGIN
      IF TG_TABLE_NAME = 'transactions' THEN
        v_status := OLD.status::text;
      ELSE
        SELECT t.status::text INTO v_status
        FROM public.transactions t
        WHERE t.id = OLD.transaction_id;
      END IF;

      IF v_status IN ('posted', 'reversed') THEN
        RAISE EXCEPTION 'DELETE forbidden on ledger table % when status = %. LEDGER-SPEC 0.3 / 8.5. Reverse instead.', TG_TABLE_NAME, v_status;
      END IF;

      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `;

  console.log('[clean-ledger] DONE! All ledger postings & transactions wiped cleanly.');
  await sql.end();
}

main().catch((err) => {
  console.error('[clean-ledger] FAIL:', err);
  process.exit(1);
});
