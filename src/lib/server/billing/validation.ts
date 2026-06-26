import 'server-only';

import { eq } from 'drizzle-orm';

import { db, type DbClient } from '@/lib/db/client';
import { validationRules } from '@/lib/db/schema';
import type { ValidationFlag } from '@/lib/server/ledger/types';

/**
 * Billing validation runner. Walks `validation_rules` rows whose
 * `config.applies_to` includes the doc kind being checked, and
 * dispatches to the matching handler.
 *
 * Distinct from `lib/server/ledger/validation.ts` (which validates
 * ledger transactions); this one validates billing DOCUMENT drafts
 * (invoice / credit-note / bill) BEFORE they post. Warnings attach to
 * `<doc>.validation_flags`; block-severity raises (block-severity isn't
 * used in v1 — the Phase 1.4 seeds are all warn).
 *
 * v1 implemented rule handlers:
 *   - gst_split_mismatch
 *   - hsn_digit_count_vs_turnover
 *   - place_of_supply_vs_supplier_state
 *
 * The remaining Phase 1.4 rules (credit_note_outside_window,
 * advance_tax_default_rate, tds_threshold_crossed) are handled in
 * their respective phase commits when the doc kind they apply to is
 * implemented.
 */

export type BillingDocKind = 'invoice' | 'credit_note' | 'bill';

export type InvoiceDraftSnapshot = {
  capturedTaxTotalPaise: bigint;
  capturedTaxSplit: {
    cgst_paise?: bigint | number | string | null;
    sgst_paise?: bigint | number | string | null;
    igst_paise?: bigint | number | string | null;
    cess_paise?: bigint | number | string | null;
  } | null;
  placeOfSupply: string | null; // 2-digit state code or null
  lines: Array<{ sacCode: string | null }>;
};

type Rule = {
  code: string;
  severity: 'info' | 'warn' | 'block';
  config: Record<string, unknown>;
};

function asBigint(v: bigint | number | string | null | undefined): bigint {
  if (v == null) return 0n;
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  return BigInt(v); // throws if not a bigint-parseable string
}

/** Returns true iff `code` ∈ rule.config.applies_to (defaults true if absent). */
function appliesTo(rule: Rule, kind: BillingDocKind): boolean {
  const applies = rule.config.applies_to;
  if (!Array.isArray(applies)) return true;
  return applies.some((k) => k === `${kind}s` || k === kind);
}

export async function runInvoiceValidations(
  draft: InvoiceDraftSnapshot,
  client: DbClient = db,
): Promise<ValidationFlag[]> {
  const enabled = (await client
    .select({
      code: validationRules.code,
      severity: validationRules.severity,
      config: validationRules.config,
    })
    .from(validationRules)
    .where(eq(validationRules.isEnabled, true))) as Rule[];

  const flags: ValidationFlag[] = [];
  for (const rule of enabled) {
    if (!appliesTo(rule, 'invoice')) continue;
    const flag = runInvoiceRule(rule, draft);
    if (flag) flags.push(flag);
  }
  return flags;
}

function runInvoiceRule(rule: Rule, draft: InvoiceDraftSnapshot): ValidationFlag | null {
  switch (rule.code) {
    case 'gst_split_mismatch': {
      const split = draft.capturedTaxSplit ?? {};
      const sum =
        asBigint(split.cgst_paise) +
        asBigint(split.sgst_paise) +
        asBigint(split.igst_paise) +
        asBigint(split.cess_paise);
      const tolerance = BigInt(Number(rule.config.tolerance_paise ?? 100));
      const diff = sum - draft.capturedTaxTotalPaise;
      const abs = diff < 0n ? -diff : diff;
      if (abs > tolerance) {
        return {
          code: 'gst_split_mismatch',
          severity: rule.severity,
          message: `CGST+SGST+IGST+CESS (${sum}) differs from captured tax total (${draft.capturedTaxTotalPaise}) by ${abs} paise.`,
          detail: {
            sum_paise: sum.toString(),
            total_paise: draft.capturedTaxTotalPaise.toString(),
          },
        };
      }
      return null;
    }

    case 'hsn_digit_count_vs_turnover': {
      // Apar is <₹5 Cr turnover for v1 → 4-digit minimum. (Upgrade to
      // read live turnover from materialized view in Phase 7.)
      const minDigits = Number(rule.config.min_digits_under_threshold ?? 4);
      const offenders = draft.lines
        .map((l, idx) => ({ idx, sac: l.sacCode ?? '' }))
        .filter((l) => l.sac.length > 0 && l.sac.length < minDigits);
      if (offenders.length > 0) {
        return {
          code: 'hsn_digit_count_vs_turnover',
          severity: rule.severity,
          message: `${offenders.length} line(s) use SAC shorter than ${minDigits} digits.`,
          detail: { offending_line_nos: offenders.map((o) => o.idx + 1) },
        };
      }
      return null;
    }

    case 'place_of_supply_vs_supplier_state': {
      const apar = String(rule.config.apar_state_code ?? '27');
      const pos = draft.placeOfSupply;
      if (!pos) return null; // not yet captured — leave the per-state-code check for sendInvoice
      const split = draft.capturedTaxSplit ?? {};
      const cgst = asBigint(split.cgst_paise);
      const sgst = asBigint(split.sgst_paise);
      const igst = asBigint(split.igst_paise);
      const isIntraState = pos === apar;

      if (isIntraState && igst > 0n) {
        return {
          code: 'place_of_supply_vs_supplier_state',
          severity: rule.severity,
          message: `Intra-state supply (POS=${pos}) but IGST captured. Expected CGST+SGST split.`,
        };
      }
      if (!isIntraState && (cgst > 0n || sgst > 0n)) {
        return {
          code: 'place_of_supply_vs_supplier_state',
          severity: rule.severity,
          message: `Inter-state supply (POS=${pos}, supplier=${apar}) but CGST/SGST captured. Expected IGST only.`,
        };
      }
      return null;
    }

    default:
      // Rules without an invoice-side handler in v1 (credit_note_outside_window,
      // advance_tax_default_rate, tds_threshold_crossed) are silently
      // skipped here — they're applied in their own phase commits.
      return null;
  }
}
