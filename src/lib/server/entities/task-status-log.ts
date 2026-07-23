import 'server-only';

import { db, type DbClient } from '@/lib/db/client';
import { projectTaskStatusEvents } from '@/lib/db/schema';

// Shared, non-'use server' helper for deliverable (project_tasks) status
// tracking. Both the admin action (updateProjectTask) and the employee action
// (updateMyTaskStatus) call these so the completion-outcome rule and the
// history log stay identical across the two surfaces.

export type TaskCompletionOutcome = 'on_time' | 'slightly_delayed' | 'delayed';

// A completion within this many days AFTER the due date counts as "slightly
// delayed"; beyond it is "delayed". On or before the due date is "on time".
export const SLIGHTLY_DELAYED_MAX_DAYS = 3;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The Asia/Kolkata calendar date (YYYY-MM-DD) of an instant. */
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Where a completion lands relative to its due date. Mirrors the SQL backfill
 * in migration 0085 exactly (IST calendar-date comparison, ≤3 days = slightly).
 * No due date ⇒ on_time — a task with no deadline can't be late.
 */
export function computeCompletionOutcome(
  completedAt: Date,
  dueOn: string | null | undefined,
): TaskCompletionOutcome {
  if (!dueOn) return 'on_time';
  const completedDate = istDateString(completedAt);
  const lateDays = Math.round(
    (Date.parse(`${completedDate}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000,
  );
  if (lateDays <= 0) return 'on_time';
  if (lateDays <= SLIGHTLY_DELAYED_MAX_DAYS) return 'slightly_delayed';
  return 'delayed';
}

/**
 * The completedAt + completionOutcome patch for a status transition. Applies
 * the "completed_at follows 'done'" rule and stamps/clears the outcome:
 *   → done: stamp completedAt = now, outcome from now vs dueOn
 *   done → anything else: clear both
 * Returns {} when the status is unchanged, or for open→open moves.
 */
export function statusTransitionPatch(
  prevStatus: string,
  nextStatus: string,
  dueOn: string | null | undefined,
  now: Date,
): { completedAt?: Date | null; completionOutcome?: string | null } {
  if (nextStatus === prevStatus) return {};
  if (nextStatus === 'done') {
    return { completedAt: now, completionOutcome: computeCompletionOutcome(now, dueOn) };
  }
  if (prevStatus === 'done') return { completedAt: null, completionOutcome: null };
  return {};
}

export type StatusEventActor = {
  kind: 'employee' | 'admin' | 'system';
  employeeId?: string | null;
  label?: string | null;
};

/**
 * Append one status-change row to a deliverable's history. Best-effort — a
 * logging failure must never roll back the status change itself, so errors are
 * swallowed (as with the audit trail). No-op when the status is unchanged.
 */
export async function recordTaskStatusEvent(
  input: { taskId: string; fromStatus: string | null; toStatus: string; actor: StatusEventActor },
  client: DbClient = db,
): Promise<void> {
  if (input.fromStatus === input.toStatus) return;
  try {
    await client.insert(projectTaskStatusEvents).values({
      taskId: input.taskId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      actorKind: input.actor.kind,
      actorEmployeeId: input.actor.employeeId ?? null,
      actorLabel: input.actor.label ?? null,
    });
  } catch (e) {
    console.error('[recordTaskStatusEvent] failed', e);
  }
}
