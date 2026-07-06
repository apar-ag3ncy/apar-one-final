// TODO(backend): replace this module with Zod-schema-derived types from `@/types/client`
// once Backend ships them (P1.12). The shapes below are frontend stand-ins so the UI shell
// can be built and reviewed before the schema is final.

export type ClientStatus = 'active' | 'onboarding' | 'inactive' | 'archived';
export type ClientPriority = 'low' | 'medium' | 'high' | 'strategic';

export type ClientPoc = {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
};

export type Client = {
  id: string;
  name: string;
  industry: string;
  status: ClientStatus;
  priority: ClientPriority;
  accountManager: string;
  accountManagerId?: string | null;
  gstin: string | null;
  pan: string | null;
  city: string;
  onboardedAt: Date;
  lastActivityAt: Date | null;
  tags: readonly string[];
  pocs: readonly ClientPoc[];
  projectsCount: number;
  documentsCount: number;
  /** Brand logo document (documents.id) — rendered instead of initials when set. */
  logoDocumentId?: string | null;
  notes: string | null;
};
