'use server';

/**
 * Entity server actions — Phase 6 wiring.
 *
 * NOTE the path is `server-stub` for historical reasons (this used to be a
 * fixture-only stub adapter). The body now hits the real DB. Consumers import
 * from this path unchanged. Once Phase 3.6–3.12 ships a more complete
 * `src/lib/server/entities/*` surface, this file should become a thin
 * re-export and then be removed.
 *
 * Currently wired (real DB):
 *   - listClients / getClient
 *   - listVendors / getVendor
 *   - listEmployees / getEmployee
 *   - listProjects / getProject
 *   - searchEntities (cross-entity ILIKE)
 *
 * Still stubbed (throws or empty):
 *   - revealBank, revealIdentifier — need KYC reveal flow (Phase 3.8)
 *   - resolveDocumentUrl, uploadDocument — need storage server action (Phase 3.10)
 *   - getEntityActivity — needs activity log query (Phase 3.3 consumer)
 */

import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';

import { maybeCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  bills,
  clients,
  employees,
  entityActivityLog,
  entityBankAccounts,
  entityContacts,
  entityTaxIdentifiers,
  invoices,
  officeExpenses,
  projects,
  users,
  vendors,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { getActorContext } from '@/lib/server/actor';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import { updateProject as updateProjectAction } from '@/lib/server/entities/projects';
import { revealBank as revealBankFromVault, revealKyc as revealKycFromVault } from '@/lib/storage';
import type { Client, ClientPoc, ClientPriority, ClientStatus } from '@/components/clients/types';
import type { Vendor, VendorCategory, VendorStatus, TdsSection } from '@/components/vendors/types';
import type {
  Employee,
  EmployeeStatus,
  EmploymentType,
  Department,
} from '@/components/employees/types';
import type {
  Project,
  ProjectStatus,
  ProjectDbStatus,
  BillingModel,
} from '@/components/projects/types';
import type { Transaction, TransactionStatus } from '@/components/entity/transaction-list';

/* -------------------------------------------------------------------------- */
/* Clients                                                                     */
/* -------------------------------------------------------------------------- */

function mapClientStatus(
  dbStatus: 'prospect' | 'active' | 'inactive',
  isArchived: boolean,
): ClientStatus {
  if (isArchived) return 'archived';
  if (dbStatus === 'prospect') return 'onboarding';
  return dbStatus;
}

const FALLBACK_PRIORITY: ClientPriority = 'medium';

export async function listClients(): Promise<readonly Client[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      industry: clients.industry,
      status: clients.status,
      isArchived: clients.isArchived,
      gstin: clients.gstin,
      pan: clients.pan,
      notes: clients.notes,
      createdAt: clients.createdAt,
      accountManagerName: sql<
        string | null
      >`(select full_name from users where id = ${clients.accountManagerId})`,
      projectsCount: sql<number>`(select count(*)::int from projects where client_id = ${clients.id} and is_archived = false)`,
      documentsCount: sql<number>`(select count(*)::int from entity_documents where entity_type = 'client' and entity_id = ${clients.id})`,
    })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .orderBy(desc(clients.updatedAt));

  return rows.map(
    (r): Client => ({
      id: r.id,
      name: r.name,
      industry: r.industry ?? '',
      status: mapClientStatus(r.status, r.isArchived),
      priority: FALLBACK_PRIORITY,
      accountManager: r.accountManagerName ?? '—',
      gstin: r.gstin,
      pan: r.pan,
      city: '',
      onboardedAt: r.createdAt,
      lastActivityAt: null,
      tags: [],
      pocs: [],
      projectsCount: r.projectsCount,
      documentsCount: r.documentsCount,
      notes: r.notes,
    }),
  );
}

export async function getClient(id: string): Promise<Client | null> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      industry: clients.industry,
      status: clients.status,
      isArchived: clients.isArchived,
      gstin: clients.gstin,
      pan: clients.pan,
      notes: clients.notes,
      createdAt: clients.createdAt,
      accountManagerName: sql<
        string | null
      >`(select full_name from users where id = ${clients.accountManagerId})`,
      projectsCount: sql<number>`(select count(*)::int from projects where client_id = ${clients.id} and is_archived = false)`,
      documentsCount: sql<number>`(select count(*)::int from entity_documents where entity_type = 'client' and entity_id = ${clients.id})`,
    })
    .from(clients)
    .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const pocRows = await db
    .select()
    .from(entityContacts)
    .where(
      and(
        eq(entityContacts.entityType, 'client'),
        eq(entityContacts.entityId, id),
        isNull(entityContacts.deletedAt),
      ),
    )
    .orderBy(desc(entityContacts.isPrimary), entityContacts.name);

  const pocs: readonly ClientPoc[] = pocRows.map(
    (p): ClientPoc => ({
      id: p.id,
      name: p.name,
      title: p.role ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      isPrimary: p.isPrimary,
    }),
  );

  return {
    id: row.id,
    name: row.name,
    industry: row.industry ?? '',
    status: mapClientStatus(row.status, row.isArchived),
    priority: FALLBACK_PRIORITY,
    accountManager: row.accountManagerName ?? '—',
    gstin: row.gstin,
    pan: row.pan,
    city: '',
    onboardedAt: row.createdAt,
    lastActivityAt: null,
    tags: [],
    pocs,
    projectsCount: row.projectsCount,
    documentsCount: row.documentsCount,
    notes: row.notes,
  };
}

/* -------------------------------------------------------------------------- */
/* Vendors                                                                     */
/* -------------------------------------------------------------------------- */

const KNOWN_VENDOR_CATEGORIES: readonly VendorCategory[] = [
  'photographer',
  'videographer',
  'printer',
  'software',
  'agency',
  'logistics',
  'other',
];

function mapVendorCategory(raw: string | null): VendorCategory {
  if (!raw) return 'other';
  return (KNOWN_VENDOR_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as VendorCategory)
    : 'other';
}

function mapVendorStatus(
  dbStatus: 'prospect' | 'active' | 'inactive',
  isArchived: boolean,
): VendorStatus {
  if (isArchived || dbStatus === 'inactive') return 'inactive';
  return 'active';
}

export async function listVendors(): Promise<readonly Vendor[]> {
  const rows = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      category: vendors.category,
      status: vendors.status,
      isArchived: vendors.isArchived,
      gstin: vendors.gstin,
      pan: vendors.pan,
      notes: vendors.notes,
      documentsCount: sql<number>`(select count(*)::int from entity_documents where entity_type = 'vendor' and entity_id = ${vendors.id})`,
    })
    .from(vendors)
    .where(isNull(vendors.deletedAt))
    .orderBy(desc(vendors.updatedAt));

  return rows.map(
    (r): Vendor => ({
      id: r.id,
      name: r.name,
      category: mapVendorCategory(r.category),
      status: mapVendorStatus(r.status, r.isArchived),
      gstin: r.gstin,
      pan: r.pan,
      tdsSection: 'none' as TdsSection,
      contactName: null,
      contactPhone: null,
      city: '',
      outstandingPaise: 0n,
      lastTxnAt: null,
      documentsCount: r.documentsCount,
      contractsCount: 0,
      notes: r.notes,
    }),
  );
}

export async function getVendor(id: string): Promise<Vendor | null> {
  const rows = await listVendors();
  return rows.find((v) => v.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Employees                                                                   */
/* -------------------------------------------------------------------------- */

const KNOWN_DEPARTMENTS: readonly Department[] = [
  'creative',
  'strategy',
  'growth',
  'operations',
  'finance',
  'engineering',
  'leadership',
];

function mapDepartment(raw: string | null): Department {
  if (!raw) return 'operations';
  return (KNOWN_DEPARTMENTS as readonly string[]).includes(raw)
    ? (raw as Department)
    : 'operations';
}

function mapEmploymentType(
  raw: 'full_time' | 'part_time' | 'contract' | 'intern' | 'consultant',
): EmploymentType {
  if (raw === 'contract' || raw === 'consultant') return 'contractor';
  return raw;
}

function mapEmployeeStatus(
  dbStatus: 'prospective' | 'active' | 'on_leave' | 'notice' | 'separated',
  isArchived: boolean,
): EmployeeStatus {
  if (isArchived || dbStatus === 'separated') return 'separated';
  if (dbStatus === 'notice') return 'notice';
  return 'active';
}

export async function listEmployees(): Promise<readonly Employee[]> {
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      designation: employees.designation,
      department: employees.department,
      employmentType: employees.employmentType,
      status: employees.status,
      isArchived: employees.isArchived,
      workEmail: employees.workEmail,
      phone: employees.phone,
      joinedOn: employees.joinedOn,
      separatedOn: employees.separatedOn,
      maskedPan: employees.maskedPan,
      maskedAadhaar: employees.maskedAadhaar,
      notes: employees.notes,
      reportsToEmployeeId: employees.reportsToEmployeeId,
      documentsCount: sql<number>`(select count(*)::int from entity_documents where entity_type = 'employee' and entity_id = ${employees.id})`,
    })
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(employees.fullName);

  return rows.map(
    (r): Employee => ({
      id: r.id,
      fullName: r.fullName,
      designation: r.designation ?? '',
      department: mapDepartment(r.department),
      employmentType: mapEmploymentType(r.employmentType),
      status: mapEmployeeStatus(r.status, r.isArchived),
      workEmail: r.workEmail ?? '',
      phone: r.phone ?? '',
      city: '',
      joinedAt: new Date(r.joinedOn),
      exitedAt: r.separatedOn ? new Date(r.separatedOn) : null,
      reportsTo: r.reportsToEmployeeId,
      panMasked: r.maskedPan,
      aadhaarMasked: r.maskedAadhaar,
      documentsCount: r.documentsCount,
      notes: r.notes,
    }),
  );
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const all = await listEmployees();
  return all.find((e) => e.id === id) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

function mapProjectStatus(
  dbStatus: 'pitch' | 'won' | 'active' | 'on_hold' | 'completed' | 'cancelled',
  isArchived: boolean,
): ProjectStatus {
  if (isArchived || dbStatus === 'cancelled') return 'closed';
  if (dbStatus === 'pitch') return 'pitching';
  if (dbStatus === 'won') return 'active';
  if (dbStatus === 'completed') return 'delivered';
  if (dbStatus === 'on_hold') return 'on_hold';
  return 'active';
}

const FALLBACK_BILLING: BillingModel = 'fixed_fee';

const PROJECT_LIST_COLUMNS = {
  id: projects.id,
  name: projects.name,
  code: projects.code,
  clientId: projects.clientId,
  clientName: clients.name,
  status: projects.status,
  feePaise: projects.feePaise,
  isArchived: projects.isArchived,
  startedOn: projects.startedOn,
  targetEndOn: projects.targetEndOn,
  notes: projects.notes,
  leadEmployeeId: projects.leadEmployeeId,
  leadEmployeeName: sql<
    string | null
  >`(select full_name from employees where id = ${projects.leadEmployeeId})`,
  accountManagerId: projects.accountManagerId,
  accountManagerName: sql<
    string | null
  >`(select full_name from users where id = ${projects.accountManagerId})`,
  documentsCount: sql<number>`(select count(*)::int from entity_documents where entity_type = 'project' and entity_id = ${projects.id})`,
} as const;

type ProjectListRowResult = {
  id: string;
  name: string;
  code: string | null;
  clientId: string;
  clientName: string | null;
  status: 'pitch' | 'won' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  feePaise: bigint;
  isArchived: boolean;
  startedOn: string | null;
  targetEndOn: string | null;
  notes: string | null;
  leadEmployeeId: string | null;
  leadEmployeeName: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  documentsCount: number;
};

function rowToProject(r: ProjectListRowResult): Project {
  return {
    id: r.id,
    code: r.code ?? '',
    name: r.name,
    clientId: r.clientId,
    clientName: r.clientName ?? '—',
    status: mapProjectStatus(r.status, r.isArchived),
    dbStatus: r.status,
    billingModel: FALLBACK_BILLING,
    leadEmployeeId: r.leadEmployeeId,
    leadName: r.leadEmployeeName ?? '—',
    accountManagerId: r.accountManagerId,
    accountManagerName: r.accountManagerName ?? '—',
    feePaise: r.feePaise,
    startedAt: r.startedOn ? new Date(r.startedOn) : new Date(),
    endsAt: r.targetEndOn ? new Date(r.targetEndOn) : null,
    deliverablesTotal: 0,
    deliverablesDone: 0,
    milestonesTotal: 0,
    milestonesDone: 0,
    documentsCount: r.documentsCount,
    notes: r.notes,
  };
}

export async function listProjects(): Promise<readonly Project[]> {
  const rows = await db
    .select(PROJECT_LIST_COLUMNS)
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map(rowToProject);
}

export async function listProjectsByClient(clientId: string): Promise<readonly Project[]> {
  const rows = await db
    .select(PROJECT_LIST_COLUMNS)
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(projects.clientId, clientId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.updatedAt));
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const all = await listProjects();
  return all.find((p) => p.id === id) ?? null;
}

export type TeamUser = {
  id: string;
  fullName: string;
  email: string;
};

/**
 * List system users — the team members who can own client/project relationships.
 * Used to populate the "account manager / POC" dropdown on the create-project
 * form. Filters to non-deleted, active users.
 */
export async function listUsers(): Promise<readonly TeamUser[]> {
  await getActorContext();
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(users.fullName);
  return rows;
}

/**
 * Inline status change from the project detail header. Wraps `updateProject`
 * from `@/lib/server/entities/projects` so the capability gate and audit log
 * stay in one place.
 */
export async function setProjectStatus(projectId: string, status: ProjectDbStatus): Promise<void> {
  await updateProjectAction(projectId, { status });
}

/**
 * Roll up every captured transaction tied to a project — client invoices
 * (income), vendor bills (spend), and office expenses (spend) — into a
 * single feed for the Transactions tab.
 *
 * Returns `incomePaise` and `spendPaise` as captured-not-computed sums of
 * `capturedTotalPaise` (or `amountPaise + gstPaise` for office expenses),
 * skipping void / draft rows so the totals match what a partner would
 * recognise as "committed money". Drafts still show in the list.
 */
export type ProjectTransactionFeed = {
  transactions: readonly Transaction[];
  incomePaise: bigint;
  spendPaise: bigint;
};

export async function listProjectTransactions(projectId: string): Promise<ProjectTransactionFeed> {
  await getActorContext();

  const [invoiceRows, billRows, expenseRows] = await Promise.all([
    db
      .select({
        id: invoices.id,
        documentNumber: invoices.documentNumber,
        documentDate: invoices.documentDate,
        capturedTotalPaise: invoices.capturedTotalPaise,
        state: invoices.state,
        clientId: invoices.clientId,
        clientName: clients.name,
        clientArchived: clients.isArchived,
        clientDeletedAt: clients.deletedAt,
        notes: invoices.notes,
      })
      .from(invoices)
      .leftJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.projectId, projectId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.documentDate)),
    db
      .select({
        id: bills.id,
        documentNumber: bills.documentNumber,
        documentDate: bills.documentDate,
        capturedTotalPaise: bills.capturedTotalPaise,
        state: bills.state,
        vendorId: bills.vendorId,
        vendorName: vendors.name,
        vendorArchived: vendors.isArchived,
        vendorDeletedAt: vendors.deletedAt,
        notes: bills.notes,
      })
      .from(bills)
      .leftJoin(vendors, eq(vendors.id, bills.vendorId))
      .where(and(eq(bills.projectId, projectId), isNull(bills.deletedAt)))
      .orderBy(desc(bills.documentDate)),
    db
      .select({
        id: officeExpenses.id,
        description: officeExpenses.description,
        expenseDate: officeExpenses.expenseDate,
        amountPaise: officeExpenses.amountPaise,
        gstPaise: officeExpenses.gstPaise,
        status: officeExpenses.status,
        vendorId: officeExpenses.vendorId,
        vendorName: officeExpenses.vendorName,
        vendorDirectoryName: vendors.name,
        vendorArchived: vendors.isArchived,
        vendorDeletedAt: vendors.deletedAt,
      })
      .from(officeExpenses)
      .leftJoin(vendors, eq(vendors.id, officeExpenses.vendorId))
      .where(and(eq(officeExpenses.projectId, projectId), isNull(officeExpenses.deletedAt)))
      .orderBy(desc(officeExpenses.expenseDate)),
  ]);

  const invoiceTxns: Transaction[] = invoiceRows.map((r) => ({
    id: r.id,
    reference: r.documentNumber,
    kind: 'client_invoice' as const,
    date: r.documentDate,
    amount: r.capturedTotalPaise,
    status: mapInvoiceState(r.state),
    counterparty: r.clientName
      ? {
          type: 'client' as const,
          id: r.clientId,
          label: r.clientName,
          archived: Boolean(r.clientArchived) || r.clientDeletedAt !== null,
        }
      : null,
    memo: r.notes,
  }));

  const billTxns: Transaction[] = billRows.map((r) => ({
    id: r.id,
    reference: r.documentNumber,
    kind: 'vendor_bill' as const,
    date: r.documentDate,
    amount: r.capturedTotalPaise,
    status: mapBillState(r.state),
    counterparty: r.vendorName
      ? {
          type: 'vendor' as const,
          id: r.vendorId,
          label: r.vendorName,
          archived: Boolean(r.vendorArchived) || r.vendorDeletedAt !== null,
        }
      : null,
    memo: r.notes,
  }));

  const expenseTxns: Transaction[] = expenseRows.map((r) => ({
    id: r.id,
    reference: `EXP-${r.id.slice(0, 8)}`,
    kind: 'office_expense' as const,
    date: r.expenseDate,
    amount: r.amountPaise + r.gstPaise,
    status: mapOfficeExpenseStatus(r.status),
    counterparty:
      r.vendorId && r.vendorDirectoryName
        ? {
            type: 'vendor' as const,
            id: r.vendorId,
            label: r.vendorDirectoryName,
            archived: Boolean(r.vendorArchived) || r.vendorDeletedAt !== null,
          }
        : null,
    memo: r.vendorName ? `${r.description} · ${r.vendorName}` : r.description,
  }));

  // Sum totals — exclude draft (not yet committed) and void (reversed) rows.
  // The list keeps drafts visible; the headline totals reflect "real money".
  let incomePaise = 0n;
  for (const r of invoiceRows) {
    if (r.state !== 'draft' && r.state !== 'void') incomePaise += r.capturedTotalPaise;
  }
  let spendPaise = 0n;
  for (const r of billRows) {
    if (r.state !== 'draft' && r.state !== 'void') spendPaise += r.capturedTotalPaise;
  }
  for (const r of expenseRows) {
    if (r.status !== 'rejected') spendPaise += r.amountPaise + r.gstPaise;
  }

  // Merge + sort by date desc, then by reference for stability.
  const all: Transaction[] = [...invoiceTxns, ...billTxns, ...expenseTxns];
  all.sort((a, b) => {
    const ad = new Date(a.date).getTime();
    const bd = new Date(b.date).getTime();
    if (ad !== bd) return bd - ad;
    return a.reference.localeCompare(b.reference);
  });

  return { transactions: all, incomePaise, spendPaise };
}

function mapInvoiceState(
  state: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void',
): TransactionStatus {
  if (state === 'paid' || state === 'partially_paid') return 'posted';
  if (state === 'void') return 'void';
  if (state === 'sent') return 'pending_approval';
  return 'draft';
}

function mapBillState(
  state: 'draft' | 'recorded' | 'partially_paid' | 'paid' | 'void',
): TransactionStatus {
  if (state === 'paid' || state === 'partially_paid' || state === 'recorded') return 'posted';
  if (state === 'void') return 'void';
  return 'draft';
}

function mapOfficeExpenseStatus(
  status: 'pending' | 'approved' | 'reimbursed' | 'rejected',
): TransactionStatus {
  if (status === 'approved' || status === 'reimbursed') return 'posted';
  if (status === 'rejected') return 'reversed';
  return 'pending_approval';
}

/* -------------------------------------------------------------------------- */
/* Sensitive reveal — bank / KYC                                               */
/* -------------------------------------------------------------------------- */

/**
 * Mint a 60-second signed URL for the encrypted account-number blob behind
 * an `entity_bank_accounts` row. Delegates the capability gate + audit / activity
 * logging to `lib/storage.ts:revealBank` (CLAUDE rule #33, brief Rule 46).
 *
 * `accountId` is the `entity_bank_accounts.id`. Caller never sees the full
 * account number directly — the returned URL points at the vault blob.
 */
export async function revealBank(accountId: string): Promise<{ url: string; expiresAt: string }> {
  const ctx = await getActorContext();

  const rows = await db
    .select({
      entityType: entityBankAccounts.entityType,
      entityId: entityBankAccounts.entityId,
      vaultObjectKey: entityBankAccounts.vaultObjectKey,
    })
    .from(entityBankAccounts)
    .where(and(eq(entityBankAccounts.id, accountId), isNull(entityBankAccounts.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', `Bank account ${accountId} not found`);

  const signed = await revealBankFromVault(ctx, {
    objectKey: row.vaultObjectKey,
    entityType: row.entityType,
    entityId: row.entityId,
  });
  return { url: signed.signedUrl, expiresAt: signed.expiresAt };
}

/**
 * Mint a 60-second signed URL for the encrypted KYC blob behind an
 * `entity_tax_identifiers` row (or any document the caller addresses via
 * the row's vault_object_key). PAN, Aadhaar, voter ID, passport scans, etc.
 *
 * Refuses when `vault_object_key` is NULL — GSTIN-style identifiers that
 * are already public have no vault blob to reveal.
 */
export async function revealIdentifier(
  identifierId: string,
): Promise<{ url: string; expiresAt: string }> {
  const ctx = await getActorContext();

  const rows = await db
    .select({
      entityType: entityTaxIdentifiers.entityType,
      entityId: entityTaxIdentifiers.entityId,
      vaultObjectKey: entityTaxIdentifiers.vaultObjectKey,
      kind: entityTaxIdentifiers.kind,
    })
    .from(entityTaxIdentifiers)
    .where(and(eq(entityTaxIdentifiers.id, identifierId), isNull(entityTaxIdentifiers.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError('not_found', `Tax identifier ${identifierId} not found`);
  if (!row.vaultObjectKey) {
    throw new AppError(
      'kyc.reveal_capability',
      `${row.kind.toUpperCase()} has no vault blob — value is captured in clear on the row.`,
    );
  }

  const signed = await revealKycFromVault(ctx, {
    objectKey: row.vaultObjectKey,
    entityType: row.entityType,
    entityId: row.entityId,
    documentKind: row.kind,
  });
  return { url: signed.signedUrl, expiresAt: signed.expiresAt };
}

/* -------------------------------------------------------------------------- */
/* Documents (still stubbed)                                                   */
/* -------------------------------------------------------------------------- */

export async function resolveDocumentUrl(
  documentId: string,
): Promise<{ url: string; expiresAt: string }> {
  // Delegates to the real signed-URL minter. KYC-bucket docs are refused
  // there and must go through revealKyc/revealBank instead.
  const signed = await getDocumentSignedUrl(documentId);
  return { url: signed.url, expiresAt: signed.expiresAt };
}

export async function uploadDocument(_input: {
  entityType: 'client' | 'vendor' | 'employee' | 'project' | 'transaction';
  entityId: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  signedAt?: string;
  signedByUs?: boolean;
  signedByThem?: boolean;
  expiresAt?: string;
}): Promise<{ documentId: string }> {
  // Phase 3.10 will replace this with real Supabase Storage + entity_documents insert.
  return { documentId: `doc_pending_${Math.random().toString(36).slice(2, 10)}` };
}

/* -------------------------------------------------------------------------- */
/* Search (Cmd+K)                                                              */
/* -------------------------------------------------------------------------- */

export async function searchEntities(query: string): Promise<
  readonly {
    type: 'client' | 'vendor' | 'employee' | 'project';
    id: string;
    title: string;
    subtitle: string | null;
  }[]
> {
  const q = query.trim();
  if (q.length === 0) return [];
  const like = `%${q}%`;

  const [clientHits, vendorHits, employeeHits, projectHits] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name, industry: clients.industry })
      .from(clients)
      .where(and(isNull(clients.deletedAt), ilike(clients.name, like)))
      .limit(8),
    db
      .select({ id: vendors.id, name: vendors.name, category: vendors.category })
      .from(vendors)
      .where(and(isNull(vendors.deletedAt), ilike(vendors.name, like)))
      .limit(8),
    db
      .select({
        id: employees.id,
        fullName: employees.fullName,
        designation: employees.designation,
      })
      .from(employees)
      .where(
        and(
          isNull(employees.deletedAt),
          or(ilike(employees.fullName, like), ilike(employees.workEmail, like)),
        ),
      )
      .limit(8),
    db
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        clientName: clients.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(isNull(projects.deletedAt), or(ilike(projects.name, like), ilike(projects.code, like))),
      )
      .limit(8),
  ]);

  return [
    ...clientHits.map((c) => ({
      type: 'client' as const,
      id: c.id,
      title: c.name,
      subtitle: c.industry,
    })),
    ...vendorHits.map((v) => ({
      type: 'vendor' as const,
      id: v.id,
      title: v.name,
      subtitle: v.category,
    })),
    ...employeeHits.map((e) => ({
      type: 'employee' as const,
      id: e.id,
      title: e.fullName,
      subtitle: e.designation,
    })),
    ...projectHits.map((p) => ({
      type: 'project' as const,
      id: p.id,
      title: p.name,
      subtitle: p.code ?? p.clientName,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Activity feed (still stubbed)                                               */
/* -------------------------------------------------------------------------- */

export async function getEntityActivity(args: {
  entityType: 'client' | 'vendor' | 'employee' | 'project';
  entityId: string;
  sinceId?: string;
}): Promise<
  readonly {
    id: string;
    kind: string;
    at: string;
    actor: string | null;
    title: string;
    body: string | null;
  }[]
> {
  await getActorContext();

  const rows = await db
    .select({
      id: entityActivityLog.id,
      kind: entityActivityLog.kind,
      at: entityActivityLog.createdAt,
      actor: users.fullName,
      title: entityActivityLog.summary,
    })
    .from(entityActivityLog)
    .leftJoin(users, eq(users.id, entityActivityLog.actorId))
    .where(
      and(
        eq(entityActivityLog.entityType, args.entityType),
        eq(entityActivityLog.entityId, args.entityId),
      ),
    )
    .orderBy(desc(entityActivityLog.createdAt))
    .limit(100);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    at: r.at.toISOString(),
    actor: r.actor ?? null,
    title: r.title,
    body: null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Current user                                                                */
/* -------------------------------------------------------------------------- */

export type CurrentUser = {
  id: string;
  fullName: string;
  email: string;
  role: 'partner' | 'admin' | 'manager' | 'accountant' | 'employee' | 'viewer';
  capabilities: readonly string[];
};

/**
 * Resolve the current session into a UI-friendly user shape. Delegates the
 * auth.uid()→users join + capability load to `lib/auth.ts:maybeCurrentUser`,
 * then attaches `fullName` + `email` from `public.users`.
 *
 * Returns `null` when there is no active session — the caller renders the
 * unauthenticated UI (login link, anonymous shell, etc.).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const ctx = await maybeCurrentUser();
  if (!ctx) return null;

  const rows = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);
  const profile = rows[0];
  if (!profile) return null;

  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    role: ctx.role,
    capabilities: Array.from(ctx.capabilities),
  };
}
