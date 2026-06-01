// TODO(backend): replace with Zod-schema-derived types from `@/types/project` once Backend
// ships them (P1.15). Frontend stand-ins until then.

export type ProjectStatus = 'pitching' | 'active' | 'on_hold' | 'delivered' | 'closed';

export type BillingModel = 'retainer' | 'fixed_fee' | 'time_and_materials' | 'milestone';

export type Project = {
  id: string;
  code: string; // APR-FY26-NNN
  name: string;
  clientId: string;
  clientName: string;
  status: ProjectStatus;
  billingModel: BillingModel;
  leadName: string;
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
