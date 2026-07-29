#!/usr/bin/env tsx
/**
 * Data Reset Script for Apār One.
 *
 * Safely clears operational/transactional data tables (clients, vendors, employees,
 * projects, tasks, billing, invoices, expenses, transactions, logs, etc.)
 * while preserving core system setup, organization settings, and OS user login credentials.
 *
 * Usage:  npx tsx scripts/reset-data.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local (takes precedence) then .env
for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(resolve(file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, valueRaw] = match;
      if (key === undefined || valueRaw === undefined) continue;
      const unquoted =
        (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
        (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
          ? valueRaw.slice(1, -1)
          : valueRaw;
      if (!process.env[key] || file === '.env.local') {
        process.env[key] = unquoted;
      }
    }
  } catch {
    // File missing is okay
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('[reset-data] FAIL: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

// Operational tables ordered strict child-first
const OPERATIONAL_TABLES = [
  // 1. Line items & Allocations
  'payment_allocations',
  'receipt_allocations',
  'bill_allocations',
  'advance_allocations',
  'estimate_invoice_links',
  'invoice_lines',
  'estimate_lines',
  'credit_note_lines',
  'bill_lines',

  // 2. Billing Header Documents
  'invoices',
  'estimates',
  'credit_notes',
  'bills',
  'receipts',
  'receipt_vouchers',
  'refund_vouchers',
  'customer_advances',
  'invoice_reminder_log',

  // 3. Ledger & Expenses
  'office_expenses',
  'postings',
  'transactions',
  'bank_statements',

  // 4. Project Tasks & Relationships
  'project_task_status_events',
  'project_task_followups',
  'project_task_assignees',
  'project_tasks',
  'project_followups',
  'project_vendors',
  'project_members',

  // 5. Projects
  'projects',

  // 6. Activities & Contacts
  'client_activities',
  'client_contacts',

  // 7. Core Entities
  'clients',
  'vendors',
  'employees',

  // 8. Polymorphic Details & Documents
  'entity_contacts',
  'entity_addresses',
  'entity_bank_accounts',
  'entity_tax_identifiers',
  'entity_documents',
  'entity_relationships',
  'entity_custom_values',
  'entity_activity_log',
  'documents',

  // 9. Audits & User Preferences
  'audit_log',
  'form_field_changes',
  'user_table_preferences',
  'user_preferences',
];

async function deleteFromTable(table: string): Promise<boolean> {
  try {
    // Try delete with id filter
    const { error } = await supabase
      .from(table)
      .delete()
      .or('id.neq.00000000-0000-0000-0000-000000000000,id.is.null');

    if (!error) {
      console.log(`[reset-data] Cleared table: ${table}`);
      return true;
    }

    // Try delete with created_at filter if no id column
    const { error: err2 } = await supabase
      .from(table)
      .delete()
      .not('created_at', 'is', null);

    if (!err2) {
      console.log(`[reset-data] Cleared table: ${table}`);
      return true;
    }

    // Try delete with no filter (some tables allow plain delete)
    const { error: err3 } = await supabase
      .from(table)
      .delete()
      .gte('created_at', '1970-01-01');

    if (!err3) {
      console.log(`[reset-data] Cleared table: ${table}`);
      return true;
    }

    console.warn(`[reset-data] Could not clear table ${table}:`, error.message);
    return false;
  } catch (err: unknown) {
    console.warn(`[reset-data] Error clearing table ${table}:`, (err as Error).message);
    return false;
  }
}

async function resetData(): Promise<void> {
  console.log('[reset-data] Preparing database for reset (updating statuses to bypass triggers)...');

  // Neutralize invoice & transaction triggers by updating status to draft/void
  await supabase.from('invoices').update({ status: 'draft' }).neq('status', 'draft');
  await supabase.from('transactions').update({ status: 'draft' }).neq('status', 'draft');
  await supabase.from('postings').update({ status: 'draft' }).neq('status', 'draft');

  console.log('[reset-data] Clearing operational tables...');
  let clearedCount = 0;

  for (const table of OPERATIONAL_TABLES) {
    const ok = await deleteFromTable(table);
    if (ok) clearedCount++;
  }

  // Second pass for remaining parent entities
  for (const table of ['projects', 'clients', 'vendors', 'employees', 'documents']) {
    await deleteFromTable(table);
  }

  console.log(`[reset-data] Operational data reset complete! (Cleared ${clearedCount} tables)`);
}

resetData().catch((err) => {
  console.error('[reset-data] Data reset failed:', err);
  process.exit(1);
});
