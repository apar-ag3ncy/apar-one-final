// Domain types for the Apar One desktop demo.
// Demo-grade — the production dashboard has its own typed models elsewhere.
//
// Money is `bigint` paise per CLAUDE.md rule #1 + LEDGER-SPEC §8.1. Inputs
// captured from UI forms parse rupees → paise via `parseRupeesToPaise` from
// `@/components/shared/format-inr` before reaching these types.

import type { IconName } from './icons';

/**
 * `bigint` count of paise. 1 rupee = 100n paise.
 *
 * Alias-only — TypeScript doesn't enforce branding here, but giving money
 * fields a named type makes the migration obvious and lets future grep
 * `: Paise` find every money field.
 */
export type Paise = bigint;

export type AppId =
  | 'clients'
  | 'vendors'
  | 'projects'
  | 'employees'
  | 'attendance'
  | 'accounts'
  | 'ledger'
  | 'reports'
  | 'dashboard'
  | 'trash'
  | 'office'
  | 'settings'
  | 'admin_console'
  // Phase 4 windows. These have no dock icon (`showInDock: false` in
  // APP_REGISTRY) — they open from other windows via beside-focused, never
  // launched stand-alone.
  | 'transactions'
  | 'documents'
  | 'bank_recon'
  // Employee-mode apps — only ever visible to a role='employee' session (a
  // restricted OS user). Self-scoped, non-financial. See EMPLOYEE_APP_IDS.
  | 'my_tasks'
  | 'my_team'
  | 'my_attendance'
  | 'my_leaves';

export type AppDef = {
  id: AppId;
  name: string;
  icon: IconName;
  size: { w: number; h: number };
  accent: string;
};

export type Client = {
  id: string;
  /** Human-readable display id 'CL-0001' (0063). */
  code?: string;
  name: string;
  industry: string;
  manager: string;
  /** Account-manager user id (null = unassigned). Drives the edit picker. */
  managerId?: string | null;
  status: string;
  activity: string;
  logo: string;
  tone: string;
  /** Signed URL for the uploaded brand logo — rendered instead of initials. */
  logoUrl?: string | null;
};

export type Vendor = {
  id: string;
  /** Human-readable display id 'VN-0001' (0063). */
  code?: string;
  name: string;
  cat: string;
  outstanding: Paise;
  last: string;
  /** Capture-only metadata — never used for tax computation. */
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Net payment terms in days (e.g. 30, 45). Captured from the agreement. */
  paymentTermsDays?: number;
  notes?: string;
  /** ISO date string the vendor was added. */
  createdAt?: string;
};

export type VendorInvoiceStatus = 'Draft' | 'Pending' | 'Approved' | 'Paid';

export type VendorInvoice = {
  id: string;
  vendorId: string;
  /** Invoice number captured from the document. */
  number: string;
  /** ISO date (DD MMM YY shown on screen). */
  date: string;
  /** Amounts captured from the document. CLAUDE rule #1: bigint paise. */
  subtotal: Paise;
  gst: Paise;
  tds: Paise;
  total: Paise;
  status: VendorInvoiceStatus;
  /** Optional reference to an uploaded file (data URL or name). */
  fileName?: string;
  notes?: string;
  createdAt: string;
};

export type VendorDocumentKind =
  | 'Agreement'
  | 'MSA'
  | 'NDA'
  | 'PO'
  | 'KYC'
  | 'GST Certificate'
  | 'Bank Details'
  | 'Other';

export type VendorDocument = {
  id: string;
  vendorId: string;
  kind: VendorDocumentKind;
  title: string;
  fileName: string;
  /** ISO date string. */
  uploadedAt: string;
  /** Optional contract end date (for agreements). */
  expiresOn?: string;
  notes?: string;
};

export type Project = {
  code: string;
  name: string;
  client: string;
  /** True when the linked client is archived / soft-deleted. UI appends
   *  "(ex-client)" so a removed client doesn't break the project view. */
  clientArchived?: boolean;
  lead: string;
  col: 'Proposed' | 'Active' | 'Review' | 'Completed';
  fee: Paise;
  /** DB id when this project comes from the real backend; absent for
   *  legacy localStorage rows. ProjectsApp uses this for update /
   *  archive server-action calls. */
  id?: string;
  /** FK to clients(id); pairs with `client` (display name). */
  clientId?: string;
  /** FK to employees(id); pairs with `lead` (display initials). */
  leadEmployeeId?: string | null;
  /** Internal POC (account manager, users.id). */
  accountManagerId?: string | null;
  /** Client-side POC (entity_contacts.id + display name). */
  clientContactId?: string | null;
  clientContactName?: string | null;
  /** Parent project id when this is a sub-project (one level deep). */
  parentProjectId?: string | null;
  /** Live sub-projects under this project. */
  subProjectCount?: number;
  /** Σ fee over live sub-projects — display-only. */
  subFeeSumPaise?: Paise;
  /** Invoices linked to this project (header or line level, non-void). */
  linkedInvoiceCount?: number;
  /** Project priority + external flag + owning department (§4.2). */
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  isExternal?: boolean;
  department?: string | null;
};

export type Employee = {
  id: string;
  name: string;
  role: string;
  dept: string;
  tone: string;
};

export type InboxDoc = {
  id: string;
  file: string;
  type: string;
  conf: 'green' | 'amber' | 'red';
  by: string;
  ago: string;
};

// `LedgerTx` (single-entry view-model) was removed in Phase 1 per the
// brownfield kickoff. Real ledger reads will flow through B's
// `<TransactionList>` (double-entry, sourced from A's `transactions` /
// `postings` tables — LEDGER-SPEC §0.1 + §5). The OS no longer ships fake
// transaction data.

// `Report` (fabricated-KPI sparkline shape) was removed once reports began
// rendering as native OS windows backed by the live ledger. The old
// fake-data `ReportDetail` / `REPORTS` path it described is gone — real
// reports route through the per-report windows in `./apps/*-window.tsx`.

// `WindowState` + `DetailKind` retired in Phase 2. The canonical shape
// now lives at `@/lib/os/store` and carries `entityId` / `tab` instead of
// `detailKind` / `detailData` — windows reference an entity by id, never
// embed the entity itself (Rule 47).
//
// `DockBounds` stays — a layout-time map from app id to dock-icon centre,
// used by Window chrome for the open-from-dock animation.

export type DockBounds = Record<string, { x: number; y: number }>;

export type CmdAction = {
  icon: IconName;
  label: string;
  hint?: string;
  run: () => void;
};
