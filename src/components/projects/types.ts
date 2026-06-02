// TODO(backend): replace with Zod-schema-derived types from `@/types/project` once Backend
// ships them (P1.15). Frontend stand-ins until then.

export type ProjectStatus = 'pitching' | 'active' | 'on_hold' | 'delivered' | 'closed';

/** Raw DB enum values — used by the inline status changer. */
export type ProjectDbStatus = 'pitch' | 'won' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export const PROJECT_DB_STATUS_LABELS: Record<ProjectDbStatus, string> = {
  pitch: 'Pitch',
  won: 'Won',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export type BillingModel = 'retainer' | 'fixed_fee' | 'time_and_materials' | 'milestone';

export type Project = {
  id: string;
  code: string; // APR-FY26-NNN
  name: string;
  clientId: string;
  clientName: string;
  /** Linked client is archived or soft-deleted. UI suffixes "(ex-client)". */
  clientArchived?: boolean;
  status: ProjectStatus;
  /** Raw DB enum — fed to the inline status changer so the dropdown reflects
   *  the underlying state rather than the collapsed UI label. */
  dbStatus: ProjectDbStatus;
  billingModel: BillingModel;
  leadEmployeeId: string | null;
  leadName: string;
  accountManagerId: string | null;
  accountManagerName: string;
  feePaise: bigint;
  startedAt: Date;
  endsAt: Date | null;
  deliverablesTotal: number;
  deliverablesDone: number;
  milestonesTotal: number;
  milestonesDone: number;
  documentsCount: number;
  notes: string | null;
};
