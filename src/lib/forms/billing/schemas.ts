/**
 * Zod schemas for billing forms.
 *
 * These schemas back the RHF + Zod resolvers in `components/entity/billing/*-form.tsx`.
 * They are intentionally NOT re-exports of the DB row types — forms accept user input
 * as strings/decimal where useful and convert to bigint paise at submission time via
 * `lib/money.ts`. The server actions (BILL-A territory) own their own parse step
 * against the generated DB types.
 *
 * Pre-gate: shapes derive from BillingResearch.md table descriptions, not from
 * `types/db.ts`. Once BILL-A's schema lands, align with the canonical row types
 * BUT keep these form schemas separate — they describe the wire shape from the
 * browser, which may carry display niceties (rupee strings, ISO dates) the DB
 * row never sees.
 */

import { z } from 'zod';

import { GSTIN_RE, HSN_RE, TDS_SECTIONS } from '@/lib/validators';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Rupee decimal string with up to 2 decimals; converted to paise on submit. */
export const RupeeStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Enter a valid rupee amount (max 2 decimals)');

/** ISO date YYYY-MM-DD. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** SAC code — 4 to 8 digits per HSN_RE. */
export const SacCodeSchema = z.string().regex(HSN_RE, 'SAC must be 4–8 digits').optional();

/** GSTIN (15-char). */
export const GstinSchema = z.string().regex(GSTIN_RE, 'Invalid GSTIN format');

/** Indian 2-letter state code (alpha). The DB stores 2-digit GSTIN state code; we
 *  accept either at the form layer and let the server canonicalize. */
export const StateCodeSchema = z.string().min(2).max(4);

export const PlaceOfSupplyKindSchema = z.enum(['intra_state', 'inter_state']);

export const TdsSectionSchema = z.enum(TDS_SECTIONS);

/** Captured GST split — all rupee strings; server converts to paise. */
export const CapturedTaxSplitSchema = z.object({
  cgst: RupeeStringSchema.default('0'),
  sgst: RupeeStringSchema.default('0'),
  igst: RupeeStringSchema.default('0'),
  cess: RupeeStringSchema.default('0'),
});

/* -------------------------------------------------------------------------- */
/* Service item (catalog)                                                      */
/* -------------------------------------------------------------------------- */

export const ServiceItemFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  sac_code: z.string().regex(HSN_RE, 'SAC must be 4–8 digits'),
  description: z.string().max(500).nullable().optional(),
  default_rate: RupeeStringSchema.default('0'),
  default_income_account_code: z.string().nullable().optional(),
  /** 1800 = 18%. Captured for reference; not authoritative on invoices. */
  default_tax_rate_bps: z.number().int().min(0).max(10000),
  is_active: z.boolean().default(true),
});
export type ServiceItemFormInput = z.infer<typeof ServiceItemFormSchema>;

/* -------------------------------------------------------------------------- */
/* Document line shared shape                                                  */
/* -------------------------------------------------------------------------- */

const DocLineSchema = z.object({
  service_item_id: z.string().uuid().nullable().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  sac_code: SacCodeSchema,
  qty: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Enter a valid quantity'),
  rate: RupeeStringSchema,
  /** Captured by the user — NOT computed from qty*rate. Reference pill compares. */
  captured_taxable_value: RupeeStringSchema,
  captured_tax_rate_bps: z.number().int().min(0).max(10000),
  captured_tax_amount: RupeeStringSchema,
});

/* -------------------------------------------------------------------------- */
/* Invoice                                                                     */
/* -------------------------------------------------------------------------- */

export const InvoiceFormSchema = z.object({
  party_entity_id: z.string().uuid('Pick a client'),
  document_number: z.string().max(16).optional(), // server assigns if blank
  document_date: IsoDateSchema,
  due_date: IsoDateSchema,
  place_of_supply: StateCodeSchema,
  place_of_supply_kind: PlaceOfSupplyKindSchema,
  captured_tax_split: CapturedTaxSplitSchema,
  terms: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source_document_id: z.string().uuid().nullable().optional(),
  lines: z.array(DocLineSchema).min(1, 'Add at least one line item'),
});
export type InvoiceFormInput = z.infer<typeof InvoiceFormSchema>;

/** Submission intent — both buttons (Save Draft / Save and Send) call the
 *  same onSubmit but pass different intents. */
export type InvoiceSubmitIntent = 'draft' | 'send';

/* -------------------------------------------------------------------------- */
/* Estimate                                                                    */
/* -------------------------------------------------------------------------- */

export const EstimateFormSchema = z.object({
  party_entity_id: z.string().uuid('Pick a client'),
  document_number: z.string().max(16).optional(),
  document_date: IsoDateSchema,
  expiry_date: IsoDateSchema.nullable().optional(),
  place_of_supply: StateCodeSchema,
  place_of_supply_kind: PlaceOfSupplyKindSchema,
  captured_tax_split: CapturedTaxSplitSchema,
  terms: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source_document_id: z.string().uuid().nullable().optional(),
  lines: z.array(DocLineSchema).min(1, 'Add at least one line item'),
});
export type EstimateFormInput = z.infer<typeof EstimateFormSchema>;

export type EstimateSubmitIntent = 'draft' | 'send';

/* -------------------------------------------------------------------------- */
/* Credit note                                                                 */
/* -------------------------------------------------------------------------- */

export const CreditNoteReasonSchema = z.enum([
  'rate_adjustment',
  'service_deficient',
  'post_invoice_discount',
  'cancellation',
  'other',
]);

const CreditNoteLineSchema = DocLineSchema.extend({
  /** Required: the invoice line this credit pulls from; null for ad-hoc. */
  original_invoice_line_id: z.string().uuid().nullable(),
});

export const CreditNoteFormSchema = z.object({
  /** Required FK to the original invoice — captured-not-computed: GST reversal
   *  requires linkage per CGST §34. */
  original_invoice_id: z.string().uuid('Pick the original invoice'),
  document_number: z.string().max(16).optional(),
  document_date: IsoDateSchema,
  reason: CreditNoteReasonSchema,
  place_of_supply: StateCodeSchema,
  place_of_supply_kind: PlaceOfSupplyKindSchema,
  captured_tax_split: CapturedTaxSplitSchema,
  notes: z.string().max(2000).nullable().optional(),
  source_document_id: z.string().uuid().nullable().optional(),
  lines: z.array(CreditNoteLineSchema).min(1, 'Add at least one line'),
});
export type CreditNoteFormInput = z.infer<typeof CreditNoteFormSchema>;

export type CreditNoteSubmitIntent = 'draft' | 'issue';

/* -------------------------------------------------------------------------- */
/* Vendor bill                                                                 */
/* -------------------------------------------------------------------------- */

export const BillAttributionSchema = z.enum(['client', 'opex', 'asset']);

/**
 * Vendor bill form. **Attribution is the second required question after vendor
 * select** (LEDGER-SPEC §3.4 + agent prompt's hard constraint). The form's
 * superRefine enforces conditional requirements:
 *   - attribution='client'  → on_behalf_of_client_id required
 *   - attribution='opex'    → expense_account_code required (a 6xxx code)
 *   - attribution='asset'   → defaults to 1510, no extra field
 */
export const BillFormSchema = z
  .object({
    party_entity_id: z.string().uuid('Pick a vendor'),
    /** Refused at submit if absent — `client_attribution_missing` validation rule. */
    attribution: BillAttributionSchema,
    on_behalf_of_client_id: z.string().uuid().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
    expense_account_code: z.string().nullable().optional(),
    vendor_document_number: z.string().min(1, "Vendor's invoice number is required").max(64),
    document_date: IsoDateSchema,
    due_date: IsoDateSchema,
    place_of_supply: StateCodeSchema,
    place_of_supply_kind: PlaceOfSupplyKindSchema,
    captured_tax_split: CapturedTaxSplitSchema,
    /** TDS captured from the bill — never computed. Reference rate pill compares
     *  against `tds_reference_sections[section].default_rate_bps`. */
    captured_tds_amount: RupeeStringSchema.default('0'),
    captured_tds_rate_bps: z.number().int().min(0).max(10000).default(0),
    captured_tds_section: TdsSectionSchema.default('none'),
    notes: z.string().max(2000).nullable().optional(),
    source_document_id: z.string().uuid().nullable().optional(),
    lines: z
      .array(
        DocLineSchema.extend({
          // Vendor bill lines have no `service_item_id` — they reference vendor
          // descriptions free-text. Override to drop that field.
          service_item_id: z.undefined().optional(),
        }),
      )
      .min(1, 'Add at least one line item'),
  })
  .superRefine((val, ctx) => {
    if (val.attribution === 'client' && !val.on_behalf_of_client_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['on_behalf_of_client_id'],
        message: 'Pick the client this bill is for',
      });
    }
    if (val.attribution === 'opex' && !val.expense_account_code) {
      ctx.addIssue({
        code: 'custom',
        path: ['expense_account_code'],
        message: 'Pick the expense account (6xxx range)',
      });
    }
  });
export type BillFormInput = z.infer<typeof BillFormSchema>;

export type BillSubmitIntent = 'draft' | 'record';

/* -------------------------------------------------------------------------- */
/* Receipt                                                                     */
/* -------------------------------------------------------------------------- */

export const ReceiptMethodSchema = z.enum([
  'razorpay',
  'bank_transfer',
  'upi',
  'cheque',
  'cash',
  'other',
]);

const AllocationSchema = z.object({
  invoice_id: z.string().uuid(),
  allocated: RupeeStringSchema,
});

export const ReceiptFormSchema = z.object({
  party_entity_id: z.string().uuid('Pick a client'),
  document_number: z.string().max(16).optional(),
  receipt_date: IsoDateSchema,
  method: ReceiptMethodSchema,
  /** Locked when method='razorpay'; comes from the payment link webhook. */
  payment_link_id: z.string().nullable().optional(),
  bank_account_id: z.string().uuid('Pick a bank account'),
  amount: RupeeStringSchema,
  captured_tds_amount: RupeeStringSchema.default('0'),
  captured_tds_section: TdsSectionSchema.default('none'),
  source_document_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Auto-FIFO defaulted by the form; the user may edit allocations[]. */
  allocations: z.array(AllocationSchema).default([]),
});
export type ReceiptFormInput = z.infer<typeof ReceiptFormSchema>;

export type ReceiptSubmitIntent = 'draft' | 'record';
