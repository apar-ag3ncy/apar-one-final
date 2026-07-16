'use server';

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { projectFollowups } from '@/lib/db/schema/project_followups';
import { AppError } from '@/lib/errors';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

/**
 * Project-level follow-up thread (§4.2). Mirrors the deliverable follow-up
 * thread (project-tasks.ts listTaskFollowups/addTaskFollowup, 0076) but keyed
 * to the project. Priority-change entries are written by updateProject inline;
 * this module lists them and adds manual follow-ups.
 */

const ProjectIdSchema = z.string().uuid();

export type ProjectFollowupRow = {
  id: string;
  note: string;
  /** 'priority_change' (auto) or 'note' (manual). */
  kind: string;
  createdBy: string | null;
  createdAt: string;
};

export async function listProjectFollowups(
  projectId: string,
): Promise<readonly ProjectFollowupRow[]> {
  await getActorContext();
  const parsed = ProjectIdSchema.parse(projectId);

  const rows = await db
    .select({
      id: projectFollowups.id,
      note: projectFollowups.note,
      kind: projectFollowups.kind,
      createdBy: projectFollowups.createdBy,
      createdAt: projectFollowups.createdAt,
    })
    .from(projectFollowups)
    .where(eq(projectFollowups.projectId, parsed))
    .orderBy(asc(projectFollowups.createdAt));

  return rows.map(
    (r): ProjectFollowupRow => ({
      id: r.id,
      note: r.note,
      kind: r.kind,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}

export async function addProjectFollowup(input: {
  projectId: string;
  note: string;
}): Promise<{ id: string }> {
  const ctx = await getActorContext();
  // Project lifecycle actions borrow update_client (same as archive/edit).
  requireCapability(ctx, 'update_client');
  const parsed = z
    .object({ projectId: z.string().uuid(), note: z.string().trim().min(1).max(2000) })
    .parse(input);

  const [row] = await db
    .insert(projectFollowups)
    .values({
      projectId: parsed.projectId,
      note: parsed.note,
      kind: 'note',
      createdBy: ctx.userId,
    })
    .returning({ id: projectFollowups.id });
  if (!row) throw new AppError('internal', 'project_followups insert returned no row');
  return { id: row.id };
}
