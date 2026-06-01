import 'server-only';

import { sql } from 'drizzle-orm';

import { db, type DbClient } from './db/client';

/**
 * Cmd+K backend. AUDIT-GAPS §4.4 + the agent-backend brief §3.4 — Postgres
 * FTS + pg_trgm across entities + entity_contacts. Tables to extend:
 *
 *   - clients.name, vendors.name, employees.full_name, projects.name
 *   - entity_contacts.name / email / phone
 *   - entity_custom_values where form_field.is_searchable = true (later)
 *
 * v1 ships with name/contact search via pg_trgm similarity. FTS index
 * creation is in `0007_search_indexes.sql` (alongside the seed migration).
 *
 * `pg_trgm` is a pre-installed Supabase extension; the migration runs
 * `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
 */

export type SearchResult = {
  kind: 'client' | 'vendor' | 'employee' | 'project';
  id: string;
  name: string;
  subtitle?: string;
  similarity: number;
};

export async function search(query: string, client: DbClient = db): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const rows = await client.execute<{
    kind: SearchResult['kind'];
    id: string;
    name: string;
    subtitle: string | null;
    similarity: number;
  }>(sql`
    WITH ranked AS (
      SELECT 'client' AS kind, id, name, industry AS subtitle, similarity(name, ${q}) AS similarity
      FROM clients
      WHERE is_archived = false AND name % ${q}
      UNION ALL
      SELECT 'vendor' AS kind, id, name, category AS subtitle, similarity(name, ${q}) AS similarity
      FROM vendors
      WHERE is_archived = false AND name % ${q}
      UNION ALL
      SELECT 'employee' AS kind, id, full_name AS name, designation AS subtitle,
             similarity(full_name, ${q}) AS similarity
      FROM employees
      WHERE is_archived = false AND full_name % ${q}
      UNION ALL
      SELECT 'project' AS kind, id, name, code AS subtitle, similarity(name, ${q}) AS similarity
      FROM projects
      WHERE is_archived = false AND name % ${q}
    )
    SELECT * FROM ranked
    ORDER BY similarity DESC, name ASC
    LIMIT 20
  `);

  // postgres-js returns rows as plain arrays
  return Array.from(
    rows as Iterable<{
      kind: SearchResult['kind'];
      id: string;
      name: string;
      subtitle: string | null;
      similarity: number;
    }>,
  ).map((r) => ({
    kind: r.kind,
    id: r.id,
    name: r.name,
    subtitle: r.subtitle ?? undefined,
    similarity: Number(r.similarity),
  }));
}
