/**
 * Shared types for the `components/entity/billing/*` family.
 *
 * Consumed by BOTH the Dashboard routes (`app/(app)/billing/*`) and the OS
 * billing windows (BILL-B). Components in this directory are DUMB:
 *   - No `next/navigation` imports. Navigation is dispatched via `onNavigate`.
 *   - No Supabase / server-action imports. Data arrives via props; mutations
 *     leave via `onSubmit` / `onAction` callbacks. The route page (Dashboard)
 *     or window host (OS) wires the real data + actions.
 *   - No `nuqs`. Filter/sort/pagination state is controlled — the call site
 *     binds it to nuqs (Dashboard) or to per-window local state (OS).
 *
 * Pre-gate note: domain shapes mirror the table shapes from BillingResearch.md.
 * Once BILL-A commits the billing schema, these types should be re-aligned
 * with the generated `types/db.ts` (or wrappers thereof).
 */

import type { NavigationTarget } from '@/components/entity/types';

/* -------------------------------------------------------------------------- */
/* Common primitives                                                           */
/* -------------------------------------------------------------------------- */

export type Paise = bigint;

/** ISO date string (YYYY-MM-DD). */
export type IsoDate = string;
/** ISO timestamp string. */
export type IsoTimestamp = string;

/** Indian state code (2-letter / 2-digit per GSTIN scheme). */
export type StateCode = string;

/** Captured tax split — CGST/SGST/IGST/cess, all paise. */
export interface CapturedTaxSplit {
  cgst_paise: Paise;
  sgst_paise: Paise;
  igst_paise: Paise;
  cess_paise: Paise;
}

/** Hint label for the GST split panel. */
export type PlaceOfSupplyKind = 'intra_state' | 'inter_state';

/** Method by which a receipt was collected. */
export type ReceiptMethod = 'razorpay' | 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'other';

/** Validation flag attached to a document (LEDGER-SPEC §1.6). */
export interface ValidationFlag {
  code: string;
  severity: 'info' | 'warn' | 'block';
  message: string;
  acknowledged_at?: IsoTimestamp | null;
  acknowledged_by?: string | null;
}

/** Light reference to a related entity, displayed inline via `<EntityRef>`. */
export interface EntityRefData {
  type: 'client' | 'vendor' | 'employee' | 'project' | 'transaction' | 'document';
  id: string;
  label: string;
  tab?: string;
}

/* -------------------------------------------------------------------------- */
/* Service items catalog                                                       */
/* -------------------------------------------------------------------------- */

export interface ServiceItem {
  id: string;
  name: string;
  sac_code: string;
  description: string | null;
  default_rate_paise: Paise;
  default_income_account_code: string | null;
  default_tax_rate_bps: number; // 1800 = 18%
  is_active: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/* -------------------------------------------------------------------------- */
/* Invoice                                                                     */
/* -------------------------------------------------------------------------- */

/** Matches `invoice_state` enum in `db/schema/invoices.ts`. */
export type InvoiceState = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';

export interface InvoiceLine {
  id: string;
  line_no: number;
  service_item_id: string | null;
  description: string;
  sac_code: string | null;
  qty: string; // numeric as string to preserve precision; UI parses
  rate_paise: Paise;
  captured_taxable_value_paise: Paise;
  captured_tax_rate_bps: number;
  captured_tax_amount_paise: Paise;
}

export interface Invoice {
  id: string;
  document_number: string;
  document_date: IsoDate;
  due_date: IsoDate;
  party: EntityRefData; // type='client'
  state: InvoiceState;
  subtotal_paise: Paise;
  captured_tax_total_paise: Paise;
  captured_total_paise: Paise;
  paid_paise: Paise;
  balance_paise: Paise;
  place_of_supply: StateCode;
  place_of_supply_kind: PlaceOfSupplyKind;
  captured_tax_split: CapturedTaxSplit;
  terms: string | null;
  notes: string | null;
  source_document_id: string | null;
  validation_flags: ValidationFlag[];
  lines: InvoiceLine[];
  linked_credit_notes: EntityRefData[];
  linked_receipts: EntityRefData[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface InvoiceFilters {
  q?: string;
  state?: InvoiceState[];
  party_id?: string;
  document_date_from?: IsoDate;
  document_date_to?: IsoDate;
  due_date_from?: IsoDate;
  due_date_to?: IsoDate;
  has_balance?: boolean;
}

export type InvoiceBulkAction = 'send' | 'void' | 'duplicate' | 'export_csv';

/* -------------------------------------------------------------------------- */
/* Estimate                                                                    */
/* -------------------------------------------------------------------------- */

export type EstimateState = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface EstimateLine {
  id: string;
  line_no: number;
  service_item_id: string | null;
  description: string;
  sac_code: string | null;
  qty: string;
  rate_paise: Paise;
  captured_taxable_value_paise: Paise;
  captured_tax_rate_bps: number;
  captured_tax_amount_paise: Paise;
}

export interface Estimate {
  id: string;
  document_number: string;
  document_date: IsoDate;
  expiry_date: IsoDate | null;
  party: EntityRefData;
  state: EstimateState;
  subtotal_paise: Paise;
  captured_tax_total_paise: Paise;
  captured_total_paise: Paise;
  place_of_supply: StateCode;
  place_of_supply_kind: PlaceOfSupplyKind;
  captured_tax_split: CapturedTaxSplit;
  terms: string | null;
  notes: string | null;
  source_document_id: string | null;
  acceptance_document_id: string | null;
  validation_flags: ValidationFlag[];
  lines: EstimateLine[];
  linked_invoices: EntityRefData[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface EstimateFilters {
  q?: string;
  state?: EstimateState[];
  party_id?: string;
  document_date_from?: IsoDate;
  document_date_to?: IsoDate;
}

export type EstimateBulkAction = 'send' | 'expire' | 'duplicate' | 'export_csv';

/* -------------------------------------------------------------------------- */
/* Credit note                                                                 */
/* -------------------------------------------------------------------------- */

export type CreditNoteState = 'draft' | 'issued' | 'applied' | 'void';

export type CreditNoteReason =
  | 'rate_adjustment'
  | 'service_deficient'
  | 'post_invoice_discount'
  | 'cancellation'
  | 'other';

export interface CreditNoteLine {
  id: string;
  line_no: number;
  /** The invoice line this credit applies against; null for ad-hoc adjustments. */
  original_invoice_line_id: string | null;
  description: string;
  sac_code: string | null;
  qty: string;
  rate_paise: Paise;
  captured_taxable_value_paise: Paise;
  captured_tax_rate_bps: number;
  captured_tax_amount_paise: Paise;
}

export interface CreditNote {
  id: string;
  document_number: string;
  document_date: IsoDate;
  party: EntityRefData;
  state: CreditNoteState;
  reason: CreditNoteReason;
  original_invoice: EntityRefData; // type='transaction' or custom — Dashboard maps
  subtotal_paise: Paise;
  captured_tax_total_paise: Paise;
  captured_total_paise: Paise;
  captured_tax_split: CapturedTaxSplit;
  place_of_supply: StateCode;
  place_of_supply_kind: PlaceOfSupplyKind;
  /** Section 34(2) window — Nov 30 of next FY, or GSTR-9 date, whichever earlier. */
  gst_impact_allowed: boolean;
  gst_impact_window_ends: IsoDate;
  notes: string | null;
  source_document_id: string | null;
  validation_flags: ValidationFlag[];
  lines: CreditNoteLine[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface CreditNoteFilters {
  q?: string;
  state?: CreditNoteState[];
  party_id?: string;
  document_date_from?: IsoDate;
  document_date_to?: IsoDate;
}

export type CreditNoteBulkAction = 'issue' | 'void' | 'export_csv';

/* -------------------------------------------------------------------------- */
/* Vendor bill                                                                 */
/* -------------------------------------------------------------------------- */

/** Matches `bill_state` enum in BILL-A's schema. Confirm against `db/schema/bills.ts` when filling Phase C1 bill bodies. */
export type BillState = 'draft' | 'received' | 'partially_paid' | 'paid' | 'void';

/** First required answer after vendor select. Form refuses to save without it. */
export type BillAttribution = 'client' | 'opex' | 'asset';

export type TdsSection =
  | '192'
  | '194C'
  | '194H'
  | '194I_building'
  | '194I_plant'
  | '194J'
  | '194O'
  | '194Q'
  | 'none';

export interface BillLine {
  id: string;
  line_no: number;
  description: string;
  sac_code: string | null;
  qty: string;
  rate_paise: Paise;
  captured_taxable_value_paise: Paise;
  captured_tax_rate_bps: number;
  captured_tax_amount_paise: Paise;
}

export interface Bill {
  id: string;
  vendor_document_number: string;
  document_number: string; // our internal sequence
  document_date: IsoDate;
  due_date: IsoDate;
  party: EntityRefData; // type='vendor'
  state: BillState;
  attribution: BillAttribution;
  /** Required iff attribution='client'. */
  on_behalf_of_client: EntityRefData | null;
  /** Optional regardless of attribution. */
  project: EntityRefData | null;
  /** Required iff attribution='opex'; an account code from the 6xxx range. */
  expense_account_code: string | null;
  subtotal_paise: Paise;
  captured_tax_total_paise: Paise;
  captured_tax_split: CapturedTaxSplit;
  captured_tds_amount_paise: Paise;
  captured_tds_rate_bps: number;
  captured_tds_section: TdsSection;
  captured_total_paise: Paise;
  paid_paise: Paise;
  balance_paise: Paise;
  place_of_supply: StateCode;
  place_of_supply_kind: PlaceOfSupplyKind;
  notes: string | null;
  source_document_id: string | null;
  validation_flags: ValidationFlag[];
  lines: BillLine[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface BillFilters {
  q?: string;
  state?: BillState[];
  attribution?: BillAttribution[];
  party_id?: string;
  on_behalf_of_client_id?: string;
  project_id?: string;
  document_date_from?: IsoDate;
  document_date_to?: IsoDate;
}

export type BillBulkAction = 'mark_paid' | 'void' | 'export_csv';

/* -------------------------------------------------------------------------- */
/* Receipt (client payment in)                                                 */
/* -------------------------------------------------------------------------- */

export type ReceiptState = 'draft' | 'recorded' | 'allocated' | 'void';

export interface ReceiptAllocation {
  id: string;
  invoice: EntityRefData;
  invoice_balance_paise: Paise; // before this allocation
  allocated_paise: Paise;
}

export interface Receipt {
  id: string;
  document_number: string;
  receipt_date: IsoDate;
  party: EntityRefData; // type='client'
  state: ReceiptState;
  method: ReceiptMethod;
  /** Set iff method='razorpay'. Disables method override in the form. */
  payment_link_id: string | null;
  bank_account_id: string;
  bank_account_label: string;
  amount_paise: Paise;
  /** TDS deducted by the client before paying. Captured, not computed. */
  captured_tds_amount_paise: Paise;
  captured_tds_section: TdsSection;
  /** Sum of `allocations[].allocated_paise` must equal `amount_paise + tds`. */
  allocations: ReceiptAllocation[];
  unallocated_paise: Paise;
  source_document_id: string | null;
  notes: string | null;
  validation_flags: ValidationFlag[];
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

export interface ReceiptFilters {
  q?: string;
  state?: ReceiptState[];
  party_id?: string;
  method?: ReceiptMethod[];
  receipt_date_from?: IsoDate;
  receipt_date_to?: IsoDate;
}

export type ReceiptBulkAction = 'void' | 'export_csv';

/* -------------------------------------------------------------------------- */
/* AR aging                                                                    */
/* -------------------------------------------------------------------------- */

export type AgingBucketMode = 'due_date' | 'invoice_date';

export interface ArAgingRow {
  party: EntityRefData;
  current_paise: Paise;
  bucket_1_30_paise: Paise;
  bucket_31_60_paise: Paise;
  bucket_61_90_paise: Paise;
  bucket_90_plus_paise: Paise;
  total_paise: Paise;
  oldest_invoice_date: IsoDate | null;
}

/* -------------------------------------------------------------------------- */
/* KPI cards                                                                   */
/* -------------------------------------------------------------------------- */

export type BillingKpiId =
  | 'outstanding'
  | 'oldest_unpaid_days'
  | 'avg_days_to_pay'
  | 'pct_in_90_plus'
  | 'invoiced_this_month'
  | 'received_this_month';

export interface BillingKpi {
  id: BillingKpiId;
  label: string;
  /** Display formatting decided by component (currency/percent/days). */
  value_paise?: Paise;
  value_pct_bps?: number; // 1234 = 12.34%
  value_days?: number;
  delta_from_prior_period?: number;
  trend?: 'up' | 'down' | 'flat';
}

/* -------------------------------------------------------------------------- */
/* Reference rate (tax_reference_rates row)                                    */
/* -------------------------------------------------------------------------- */

export interface ReferenceRate {
  id: string;
  kind: 'gst' | 'tds' | 'other';
  code: string;
  description: string;
  rate_bps: number;
  effective_from: IsoDate;
  effective_to: IsoDate | null;
  statutory_section: string | null;
  sac_code: string | null;
}

/* -------------------------------------------------------------------------- */
/* Activity feed                                                               */
/* -------------------------------------------------------------------------- */

/** Subset of `entity_activity_log.kind` that the billing feed renders. */
export type BillingActivityKind =
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.viewed'
  | 'invoice.voided'
  | 'estimate.created'
  | 'estimate.sent'
  | 'estimate.accepted'
  | 'estimate.converted_to_invoice'
  | 'credit_note.issued'
  | 'credit_note.applied'
  | 'bill.received'
  | 'bill.paid'
  | 'payment.received'
  | 'payment.failed'
  | 'service_item.created';

/* -------------------------------------------------------------------------- */
/* Common controlled-table props                                               */
/* -------------------------------------------------------------------------- */

/** Sort applied to a table. Mirrors @tanstack/react-table SortingState shape. */
export type SortingState = Array<{ id: string; desc: boolean }>;

/** Pagination — zero-indexed page. */
export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

/**
 * Common props every list component accepts. Filters/sort/pagination/selection
 * are controlled (state lives in the call site so nuqs / window-local-state
 * can own it).
 */
export interface BaseListProps<TFilters, TBulkAction> {
  loading?: boolean;
  totalRows?: number;
  filters: TFilters;
  onFiltersChange: (filters: TFilters) => void;
  sort?: SortingState;
  onSortChange?: (sort: SortingState) => void;
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  selection?: Record<string, boolean>;
  onSelectionChange?: (selection: Record<string, boolean>) => void;
  onNavigate?: (target: NavigationTarget) => void;
  onBulkAction?: (action: TBulkAction, ids: string[]) => void;
  /** Optional table-key override for `user_table_preferences`. */
  tableKey?: string;
}

export type { NavigationTarget };
