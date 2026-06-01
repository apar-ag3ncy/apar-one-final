/**
 * Shared types for the entity-creation wizards (client / vendor / employee).
 *
 * Document drafts are held client-side as real `File` objects through the
 * wizard. They are NOT uploaded until the principal row exists — the post-
 * create orchestrator (`run-post-create.ts`) turns them into `uploadDocument`
 * / `uploadKycDocument` calls once we have the new entity id.
 */

export type CreationEntityType = 'client' | 'vendor' | 'employee';

/** Mirrors the `document_kind` pg enum (entity_documents.ts). */
export type DocumentKind =
  | 'contract'
  | 'msa'
  | 'sow'
  | 'nda'
  | 'offer_letter'
  | 'separation_letter'
  | 'kyc_pan'
  | 'kyc_aadhaar'
  | 'kyc_passport'
  | 'kyc_voter_id'
  | 'kyc_driving_license'
  | 'cancelled_cheque'
  | 'bank_statement'
  | 'invoice'
  | 'receipt'
  | 'payslip'
  | 'salary_sheet'
  | 'reimbursement_receipt'
  | 'expense_receipt'
  | 'photo'
  | 'other';

/**
 * Kinds that MUST go through the gated `restricted-kyc` upload path
 * (`uploadKycDocument`). This set is kept in lock-step with the `KycKind`
 * enum in `src/lib/server/entities/kyc.ts` — anything here is refused by the
 * general `uploadDocument` and routed to the KYC vault. `cancelled_cheque`
 * and `bank_statement` carry account numbers, so they belong in the vault
 * even though they aren't `kyc_`-prefixed.
 */
const KYC_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'kyc_pan',
  'kyc_aadhaar',
  'kyc_passport',
  'kyc_voter_id',
  'kyc_driving_license',
  'cancelled_cheque',
  'bank_statement',
]);

/** A KYC kind routes to the gated `restricted-kyc` upload path. */
export function isKycKind(kind: DocumentKind): boolean {
  return KYC_KINDS.has(kind);
}

export type DocumentDraft = {
  /** Stable client-side id for list keys. */
  uid: string;
  file: File | null;
  kind: DocumentKind;
  /** Free-text label — e.g. an invoice number or a contract title. */
  title: string;
  /** Optional captured date (YYYY-MM-DD). For invoices: the invoice date. */
  docDate: string;
  /** Optional captured amount as a display string (paise not computed). */
  amount: string;
};

export type DocumentKindOption = { value: DocumentKind; label: string; kyc?: boolean };

const COMMON_TAIL: readonly DocumentKindOption[] = [
  { value: 'bank_statement', label: 'Bank statement', kyc: true },
  { value: 'other', label: 'Other document' },
];

/**
 * Curated kind options per entity type — keeps the dropdown relevant.
 * "Invoice" covers both our invoices to a client and a vendor's bills to us.
 */
export const DOCUMENT_KIND_OPTIONS: Record<CreationEntityType, readonly DocumentKindOption[]> = {
  client: [
    { value: 'invoice', label: 'Previous invoice' },
    { value: 'receipt', label: 'Payment receipt' },
    { value: 'contract', label: 'Contract' },
    { value: 'msa', label: 'MSA' },
    { value: 'sow', label: 'SOW' },
    { value: 'nda', label: 'NDA' },
    ...COMMON_TAIL,
  ],
  vendor: [
    { value: 'invoice', label: 'Previous bill / invoice' },
    { value: 'receipt', label: 'Payment receipt' },
    { value: 'contract', label: 'Contract' },
    { value: 'msa', label: 'MSA' },
    { value: 'cancelled_cheque', label: 'Cancelled cheque', kyc: true },
    ...COMMON_TAIL,
  ],
  employee: [
    { value: 'offer_letter', label: 'Offer letter / contract' },
    { value: 'kyc_pan', label: 'PAN card (KYC)', kyc: true },
    { value: 'kyc_aadhaar', label: 'Aadhaar (KYC)', kyc: true },
    { value: 'kyc_passport', label: 'Passport (KYC)', kyc: true },
    { value: 'kyc_driving_license', label: 'Driving licence (KYC)', kyc: true },
    { value: 'cancelled_cheque', label: 'Cancelled cheque (KYC)', kyc: true },
    { value: 'payslip', label: 'Prior payslip' },
    { value: 'salary_sheet', label: 'Salary sheet' },
    ...COMMON_TAIL,
  ],
};

export function newDocumentDraft(kind: DocumentKind): DocumentDraft {
  // Cheap unique id without Date.now()/Math.random() reliance for keys only.
  const uid = `d-${Math.random().toString(36).slice(2, 9)}`;
  return { uid, file: null, kind, title: '', docDate: '', amount: '' };
}
