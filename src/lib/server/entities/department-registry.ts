import 'server-only';

import { db } from '@/lib/db/client';
import { departments } from '@/lib/db/schema/departments';

/** Canonical stored form for a department name: trimmed + lowercased. */
export function normalizeDepartmentName(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * Idempotently register a department name in the registry. Used when an
 * employee is saved with a department typed in the quick form, so the managed
 * list stays complete. Best-effort + non-throwing: the employee write is the
 * primary operation and must not fail if registry insertion does. Does NOT
 * revive a soft-deleted department (use createDepartment for an explicit add).
 */
export async function ensureDepartmentRegistered(
  name: string | null | undefined,
  actorId: string,
): Promise<void> {
  const n = normalizeDepartmentName(name);
  if (!n) return;
  try {
    await db
      .insert(departments)
      .values({ name: n, createdBy: actorId, updatedBy: actorId })
      .onConflictDoNothing({ target: departments.name });
  } catch {
    /* registry is non-critical to the employee write */
  }
}
