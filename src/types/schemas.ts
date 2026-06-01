import { z } from 'zod';

/**
 * Zod schemas for write paths. These mirror the eventual server-validated
 * shapes; when Backend ships `types/api.ts` with generated Zod, this module
 * will re-export from there. Today this is the canonical Zod source for
 * forms that submit to the stub adapter.
 *
 * Conventions:
 *   - Money is `bigint paise`. Forms convert before validation; never
 *     `z.number()` for amounts.
 *   - Indian identifier regexes match CLAUDE.md §India rules.
 *   - Use `.refine` for cross-field rules (e.g. amendment §1 email-or-phone).
 */

export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const HSN_SAC = /^[0-9]{4,8}$/;

export const ContactInput = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    title: z.string().trim().optional().nullable(),
    email: z.string().trim().email().optional().or(z.literal('')),
    phone: z.string().trim().optional().or(z.literal('')),
    isPrimary: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    path: ['email'],
    message: 'Email or phone required (amendment §1)',
  });

export const AddressInput = z.object({
  label: z.string().trim().optional().nullable(),
  line1: z.string().trim().min(1, 'Line 1 required'),
  line2: z.string().trim().optional().nullable(),
  city: z.string().trim().min(1, 'City required'),
  state: z.string().trim().min(1, 'State required'),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, '6-digit PIN code'),
  country: z.string().trim().default('India'),
  gstin: z.string().trim().regex(GSTIN, 'Invalid GSTIN').optional().or(z.literal('')),
  isPrimary: z.boolean().default(false),
});

export const BankAccountInput = z.object({
  bankName: z.string().trim().min(1, 'Bank name required'),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{8,18}$/, 'Account number must be 8-18 digits'),
  ifsc: z.string().trim().regex(IFSC, 'Invalid IFSC'),
  holderName: z.string().trim().min(1, 'Holder name required'),
  accountType: z.enum(['savings', 'current', 'od', 'cc']).default('current'),
  branch: z.string().trim().optional().nullable(),
  isPrimary: z.boolean().default(false),
});

export const TaxIdentifierInput = z
  .object({
    kind: z.enum(['pan', 'gstin', 'tan', 'msme', 'aadhaar', 'other']),
    value: z.string().trim().min(1, 'Value required'),
    label: z.string().trim().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'pan' && !PAN.test(v.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid PAN' });
    }
    if (v.kind === 'gstin' && !GSTIN.test(v.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid GSTIN' });
    }
  });

export const TransactionLineInput = z.object({
  description: z.string().trim().min(1, 'Description required'),
  hsn: z.string().trim().regex(HSN_SAC, 'HSN must be 4-8 digits').optional().or(z.literal('')),
  quantity: z.number().min(0, 'Quantity ≥ 0'),
  unitPricePaise: z.bigint().nonnegative(),
  gstPct: z.number().min(0).max(28).default(0),
  tdsSection: z.enum(['194C', '194J', '194H', '194I', '194Q', '194O', 'none']).optional(),
});

export const VendorBillInput = z
  .object({
    vendorId: z.string().min(1, 'Vendor required'),
    attribution: z.enum(['client', 'opex', 'asset'], {
      message: 'Attribution required (client / OpEx / asset)',
    }),
    clientId: z.string().optional(),
    projectId: z.string().optional(),
    expenseAccountCode: z.string().optional(),
    billNumber: z.string().trim().min(1, 'Bill number required'),
    billDate: z.string().min(1, 'Bill date required'),
    memo: z.string().optional(),
    lines: z.array(TransactionLineInput).min(1, 'At least one line item'),
    sourceDocumentId: z.string().min(1, 'Source document required'),
  })
  .superRefine((v, ctx) => {
    if (v.attribution === 'client' && !v.clientId) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'Client required for client attribution',
      });
    }
    if (v.attribution === 'opex' && !v.expenseAccountCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['expenseAccountCode'],
        message: 'Expense account required for OpEx attribution',
      });
    }
  });

export const ClientInvoiceInput = z.object({
  clientId: z.string().min(1, 'Client required'),
  projectId: z.string().optional(),
  invoiceNumber: z.string().trim().min(1, 'Invoice number required'),
  invoiceDate: z.string().min(1, 'Invoice date required'),
  placeOfSupply: z.string().optional(),
  dueDate: z.string().optional(),
  lines: z.array(TransactionLineInput).min(1, 'At least one line item'),
  sourceDocumentId: z.string().optional(),
});

export const LeaveApplyInput = z
  .object({
    kind: z.enum(['casual', 'earned', 'sick', 'bereavement', 'lop']),
    from: z.string().min(1, 'From date required'),
    to: z.string().min(1, 'To date required'),
    reason: z.string().trim().min(3, 'Reason required'),
  })
  .refine((v) => v.to >= v.from, {
    path: ['to'],
    message: 'To date must be on or after From',
  });

export const ReimbursementInput = z.object({
  summary: z.string().trim().min(1, 'Summary required'),
  date: z.string().min(1, 'Date required'),
  amountPaise: z.bigint().positive('Amount must be > 0'),
  notes: z.string().optional(),
  receiptDocumentId: z.string().min(1, 'Receipt required'),
});

export const JournalVoucherLineInput = z.object({
  accountCode: z.string().min(1, 'Account required'),
  description: z.string().trim().optional(),
  debitPaise: z.bigint().nonnegative(),
  creditPaise: z.bigint().nonnegative(),
});

export const JournalVoucherInput = z
  .object({
    date: z.string().min(1, 'Date required'),
    reason: z.string().trim().min(10, 'Reason must be 10+ characters'),
    lines: z.array(JournalVoucherLineInput).min(2, 'At least two lines'),
  })
  .refine(
    (v) => {
      const debit = v.lines.reduce((s, l) => s + l.debitPaise, 0n);
      const credit = v.lines.reduce((s, l) => s + l.creditPaise, 0n);
      return debit === credit && debit > 0n;
    },
    {
      path: ['lines'],
      message: 'Debits must equal credits and be > 0',
    },
  );

export type ContactInput = z.infer<typeof ContactInput>;
export type AddressInput = z.infer<typeof AddressInput>;
export type BankAccountInput = z.infer<typeof BankAccountInput>;
export type TaxIdentifierInput = z.infer<typeof TaxIdentifierInput>;
export type TransactionLineInput = z.infer<typeof TransactionLineInput>;
export type VendorBillInput = z.infer<typeof VendorBillInput>;
export type ClientInvoiceInput = z.infer<typeof ClientInvoiceInput>;
export type LeaveApplyInput = z.infer<typeof LeaveApplyInput>;
export type ReimbursementInput = z.infer<typeof ReimbursementInput>;
export type JournalVoucherInput = z.infer<typeof JournalVoucherInput>;
