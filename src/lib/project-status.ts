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

/** PROJECT-level priority (§4.2) — distinct from the deliverable priority above. */
export type ProjectPriority = 'urgent' | 'high' | 'normal' | 'low';

/** Display metadata for the project priority pill/chip. `rank` sorts the board
 *  (higher floats up); external projects add a further bump at the call site. */
export const PROJECT_PRIORITY_META: Record<
  ProjectPriority,
  { label: string; bg: string; fg: string; rank: number }
> = {
  urgent: { label: 'Urgent', bg: 'rgba(214,58,31,0.16)', fg: '#d6431f', rank: 3 },
  high: { label: 'High', bg: 'rgba(208,138,30,0.16)', fg: '#d08a1e', rank: 2 },
  normal: { label: 'Normal', bg: 'rgba(120,120,120,0.16)', fg: 'var(--text-muted)', rank: 1 },
  low: { label: 'Low', bg: 'rgba(90,120,220,0.14)', fg: '#5a78dc', rank: 0 },
};

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
