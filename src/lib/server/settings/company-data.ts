import 'server-only';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { companyBankAccounts, companyDocuments, organizations } from '@/lib/db/schema';

/**
 * Pure read helpers for Settings → Company details / Billing. Kept OUT of the
 * `'use server'` action module so server components can import them directly
 * and so the document-download route handler can read the file bytes without
 * the action-serialization boundary. Capability gating lives in the action
 * wrappers (company.ts) and the route handler; these are unguarded reads.
 */

export type CompanyProfile = {
  id: string;
  legalName: string;
  displayName: string;
  gstin: string | null;
  pan: string | null;
  tan: string | null;
  udyam: string | null;
  /** Primary / registered address — the one the invoice PDFs use. */
  registeredAddress: string | null;
  secondaryAddress: string | null;
};

export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const [row] = await db
    .select({
      id: organizations.id,
      legalName: organizations.legalName,
      displayName: organizations.displayName,
      gstin: organizations.gstin,
      pan: organizations.pan,
      tan: organizations.tan,
      udyam: organizations.udyam,
      registeredAddress: organizations.registeredAddress,
      secondaryAddress: organizations.secondaryAddress,
    })
    .from(organizations)
    .limit(1);
  return row ?? null;
}

export type CompanyBankAccountRow = {
  id: string;
  title: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branchName: string | null;
  upiId: string | null;
  isPrimary: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: string;
};

export async function listCompanyBankAccounts(): Promise<CompanyBankAccountRow[]> {
  const rows = await db
    .select({
      id: companyBankAccounts.id,
      title: companyBankAccounts.title,
      accountNumber: companyBankAccounts.accountNumber,
      ifsc: companyBankAccounts.ifsc,
      bankName: companyBankAccounts.bankName,
      branchName: companyBankAccounts.branchName,
      upiId: companyBankAccounts.upiId,
      isPrimary: companyBankAccounts.isPrimary,
      sortOrder: companyBankAccounts.sortOrder,
      notes: companyBankAccounts.notes,
      createdAt: companyBankAccounts.createdAt,
    })
    .from(companyBankAccounts)
    .where(isNull(companyBankAccounts.deletedAt))
    // Primary always floats to the top, then manual order, then oldest-first.
    .orderBy(
      desc(companyBankAccounts.isPrimary),
      asc(companyBankAccounts.sortOrder),
      asc(companyBankAccounts.createdAt),
    );
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * The bank account to print on invoices: the primary one, else the first.
 * Returns null when the agency hasn't added any account yet (the invoice
 * simply omits the payment block in that case).
 */
export async function getPrimaryCompanyBankAccount(): Promise<CompanyBankAccountRow | null> {
  const rows = await listCompanyBankAccounts();
  return rows.find((r) => r.isPrimary) ?? rows[0] ?? null;
}

/**
 * A specific (non-deleted) bank account by id — used when an invoice pins which
 * account to print. Returns null if it's missing/retired so the caller can fall
 * back to the primary account.
 */
export async function getCompanyBankAccountById(id: string): Promise<CompanyBankAccountRow | null> {
  const rows = await listCompanyBankAccounts();
  return rows.find((r) => r.id === id) ?? null;
}

export type CompanyDocumentCategory =
  | 'gst'
  | 'tan'
  | 'pan'
  | 'udyam'
  | 'incorporation'
  | 'partnership_deed'
  | 'rent_agreement'
  | 'other';

export type CompanyDocumentRow = {
  id: string;
  category: CompanyDocumentCategory;
  title: string;
  referenceNumber: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  notes: string | null;
  createdAt: string;
};

/** Metadata only — never selects the `data` bytea column. */
export async function listCompanyDocuments(): Promise<CompanyDocumentRow[]> {
  const rows = await db
    .select({
      id: companyDocuments.id,
      category: companyDocuments.category,
      title: companyDocuments.title,
      referenceNumber: companyDocuments.referenceNumber,
      originalFilename: companyDocuments.originalFilename,
      mimeType: companyDocuments.mimeType,
      sizeBytes: companyDocuments.sizeBytes,
      notes: companyDocuments.notes,
      createdAt: companyDocuments.createdAt,
    })
    .from(companyDocuments)
    .where(isNull(companyDocuments.deletedAt))
    .orderBy(asc(companyDocuments.category), desc(companyDocuments.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export type CompanyDocumentBlob = {
  data: Buffer;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
};

/** Reads the file bytes for the download/view route. Returns null if missing. */
export async function getCompanyDocumentBlob(id: string): Promise<CompanyDocumentBlob | null> {
  const [row] = await db
    .select({
      data: companyDocuments.data,
      mimeType: companyDocuments.mimeType,
      originalFilename: companyDocuments.originalFilename,
      sizeBytes: companyDocuments.sizeBytes,
    })
    .from(companyDocuments)
    .where(and(eq(companyDocuments.id, id), isNull(companyDocuments.deletedAt)))
    .limit(1);
  return row ?? null;
}
