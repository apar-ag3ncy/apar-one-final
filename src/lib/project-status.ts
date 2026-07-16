/**
 * Sync helpers shared between the OS ProjectsApp UI and the server-side
 * `entities/projects` module. Lives outside `'use server'` so the
 * synchronous functions are importable from client components.
 */

import type { ProjectStatus } from './server/entities/projects';
import type { ProjectTaskPriority } from './server/entities/project-tasks';

export type ProjectCol = 'Proposed' | 'Active' | 'Review' | 'Completed';

export const PROJECT_COLS: readonly ProjectCol[] = ['Proposed', 'Active', 'Review', 'Completed'];

/**
 * DISPLAY-ONLY mapping of the stored task priority (a text() column with 4
 * legacy values) to the founder's three-tier emoji scale. The stored values
 * and enum are unchanged — legacy 'urgent' rows collapse into 🔥🔥🔥 alongside
 * 'urgent_important'. Used across the OS project / employee / vendor windows.
 */
export const TASK_PRIORITY_EMOJI: Record<
  ProjectTaskPriority,
  { emoji: string; label: string; tip: string }
> = {
  urgent_important: { emoji: '🔥🔥🔥', label: 'Urgent', tip: 'Urgent — do first' },
  urgent: { emoji: '🔥🔥🔥', label: 'Urgent', tip: 'Urgent — do first' },
  important: {
    emoji: '🔥🔥',
    label: 'Important',
    tip: 'Important, not extremely urgent — do when no urgent tasks',
  },
  nice: { emoji: '🧊', label: 'Nice / later', tip: 'Not needed now, better if completed' },
};

// The 3 options offered in priority <select>s (the founder's 3 tiers). Legacy
// 'urgent' rows still render via TASK_PRIORITY_EMOJI but aren't a separate pick.
export const TASK_PRIORITY_OPTIONS: ReadonlyArray<{ value: ProjectTaskPriority; label: string }> = [
  { value: 'urgent_important', label: '🔥🔥🔥 Urgent' },
  { value: 'important', label: '🔥🔥 Important' },
  { value: 'nice', label: '🧊 Nice / later' },
];

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
