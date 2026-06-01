/**
 * Sync helpers shared between the OS ProjectsApp UI and the server-side
 * `entities/projects` module. Lives outside `'use server'` so the
 * synchronous functions are importable from client components.
 */

import type { ProjectStatus } from './server/entities/projects';

export type ProjectCol = 'Proposed' | 'Active' | 'Review' | 'Completed';

export const PROJECT_COLS: readonly ProjectCol[] = ['Proposed', 'Active', 'Review', 'Completed'];

/** DB status → OS kanban column. Cancelled rolls into Completed. */
export function dbStatusToCol(status: ProjectStatus): ProjectCol {
  switch (status) {
    case 'pitch':
    case 'won':
      return 'Proposed';
    case 'active':
      return 'Active';
    case 'on_hold':
      return 'Review';
    case 'completed':
    case 'cancelled':
      return 'Completed';
  }
}

/** OS column → DB status. Picks the most representative value. */
export function colToDbStatus(col: ProjectCol): ProjectStatus {
  switch (col) {
    case 'Proposed':
      return 'pitch';
    case 'Active':
      return 'active';
    case 'Review':
      return 'on_hold';
    case 'Completed':
      return 'completed';
  }
}
