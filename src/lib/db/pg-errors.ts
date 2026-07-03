/**
 * True when a query failed because the target relation doesn't exist yet —
 * Postgres error 42P01 (`undefined_table`). Used to degrade gracefully when a
 * migration hasn't been applied on a given database (e.g. a new table added in
 * code but not yet migrated onto prod), instead of hard-erroring a page.
 */
export function isUndefinedTableError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown }; message?: unknown } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.cause?.code === '42P01') return true;
  return typeof e.message === 'string' && /(does not exist|undefined_table|42P01)/i.test(e.message);
}
