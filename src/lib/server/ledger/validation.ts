import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { AppError } from '@/lib/errors';
import { db, type DbClient } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';
import { validationRules } from '@/lib/db/schema/validation_rules';

import type { PostingTemplateResult, ValidationFlag } from './types';

/**
 * Validation engine. LEDGER-SPEC §4.
 *
 *   - Reads `validation_rules` rows where `is_enabled = true`.
 *   - For each, dispatches to the matching rule handler.
 *   - Returns a list of `ValidationFlag`s. `block` severity raises
 *     `AppError('ledger.attribution_missing')` etc.; `warn` / `info`
 *     attach to the transaction's `validation_flags`.
 *
 * v1 enabled rules per the migration seed:
 *   - document_missing (block)
 *   - external_ref_clash (block)
 *   - client_attribution_missing (block) — §0.6 sacred guard
 *
 * v2+ enables the GST / TDS / period / archived rules.
 */

type Rule = {
  code: string;
  severity: 'info' | 'warn' | 'block';
  config: Record<string, unknown>;
};

export async function runValidations(
  template: PostingTemplateResult,
  inputs: { kind: string; attribution?: string },
  client: DbClient = db,
): Promise<ValidationFlag[]> {
  const enabled = await client
    .select({
      code: validationRules.code,
      severity: validationRules.severity,
      config: validationRules.config,
    })
    .from(validationRules)
    .where(eq(validationRules.isEnabled, true));

  const flags: ValidationFlag[] = [];
  for (const rule of enabled as Rule[]) {
    const flag = await runOne(rule, template, inputs, client);
    if (flag) flags.push(flag);
  }
  return flags;
}

async function runOne(
  rule: Rule,
  template: PostingTemplateResult,
  inputs: { kind: string; attribution?: string },
  client: DbClient,
): Promise<ValidationFlag | null> {
  switch (rule.code) {
    case 'document_missing':
      if (
        !template.sourceDocumentId &&
        !['journal', 'inter_bank_transfer'].includes(inputs.kind) &&
        template.sourceKind !== 'opening_balance'
      ) {
        const flag: ValidationFlag = {
          code: 'document_missing',
          severity: rule.severity,
          message: `Transaction kind '${inputs.kind}' requires a source document.`,
        };
        if (rule.severity === 'block') {
          throw new AppError('ledger.source_document_missing', flag.message, {
            detail: flag,
          });
        }
        return flag;
      }
      return null;

    case 'external_ref_clash': {
      const existing = await client
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.externalRef, template.externalRef))
        .limit(1);
      if (existing[0]) {
        const flag: ValidationFlag = {
          code: 'external_ref_clash',
          severity: rule.severity,
          message: `Duplicate external_ref "${template.externalRef}".`,
          detail: { existing_transaction_id: existing[0].id },
        };
        if (rule.severity === 'block') {
          throw new AppError('ledger.external_ref_clash', flag.message, { detail: flag });
        }
        return flag;
      }
      return null;
    }

    case 'client_attribution_missing':
      if (inputs.kind === 'vendor_bill' && !inputs.attribution) {
        const flag: ValidationFlag = {
          code: 'client_attribution_missing',
          severity: rule.severity,
          message: 'vendor_bill requires explicit attribution: client | opex | asset.',
        };
        if (rule.severity === 'block') {
          throw new AppError('ledger.attribution_missing', flag.message, { detail: flag });
        }
        return flag;
      }
      return null;

    case 'period_closed': {
      // Only meaningful when settings.enforce_period_close = true.
      // Cheap to skip if disabled.
      const enforced = await client.execute<{ value_bool: boolean | null }>(sql`
        SELECT value_bool FROM settings WHERE key = 'enforce_period_close' LIMIT 1
      `);
      const isOn = Array.isArray(enforced) ? enforced[0]?.value_bool === true : false;
      if (!isOn) return null;
      // Otherwise check that the resolved period is open.
      const periodInfo = await client.execute<{ status: string }>(sql`
        SELECT status FROM periods
        WHERE ${template.txnDate}::date BETWEEN starts_on AND ends_on
        LIMIT 1
      `);
      const status = Array.isArray(periodInfo) ? periodInfo[0]?.status : undefined;
      if (status === 'closed') {
        const flag: ValidationFlag = {
          code: 'period_closed',
          severity: rule.severity,
          message: 'Posting into a closed period (period_closed enforcement is on).',
          detail: { txn_date: template.txnDate },
        };
        if (rule.severity === 'block') {
          throw new AppError('ledger.period_closed', flag.message, { detail: flag });
        }
        return flag;
      }
      return null;
    }

    case 'gst_rate_mismatch': {
      // Walks line_items on the 4100 / 5100 credit/debit posting's
      // metadata (stashed by `clientInvoice` / `vendorBill` posting
      // templates) and compares the captured GST rate against
      // tax_reference_rates for kind='gst' active at the txn date.
      // Tolerance: 1 basis point. Warn-severity only.
      for (const p of template.postings) {
        const metaItems = (p.metadata as { line_items?: Array<{ gst_rate_bps?: number }> } | undefined)
          ?.line_items;
        if (!metaItems) continue;
        for (const it of metaItems) {
          if (typeof it.gst_rate_bps !== 'number') continue;
          const ref = await client.execute<{ rate_bps: number }>(sql`
            SELECT rate_bps FROM tax_reference_rates
            WHERE kind = 'gst'
              AND is_enabled = true
              AND ${template.txnDate}::date >= effective_from
              AND (effective_to IS NULL OR ${template.txnDate}::date < effective_to)
            ORDER BY effective_from DESC
            LIMIT 1
          `);
          const refBps = Array.isArray(ref) ? ref[0]?.rate_bps : undefined;
          if (refBps !== undefined && Math.abs(it.gst_rate_bps - refBps) > 1) {
            return {
              code: 'gst_rate_mismatch',
              severity: rule.severity,
              message: `Captured GST rate ${(it.gst_rate_bps / 100).toFixed(2)}% differs from reference ${(refBps / 100).toFixed(2)}%.`,
              detail: { captured_bps: it.gst_rate_bps, reference_bps: refBps },
            };
          }
        }
      }
      return null;
    }

    case 'tds_missing': {
      // For vendor_bill transactions where the (template) metadata
      // indicates a TDS-eligible section but no TDS amount was
      // captured. The posting template stores tds_section / tds_amount
      // in the postings.metadata; we walk debit-side postings.
      if (inputs.kind !== 'vendor_bill') return null;
      for (const p of template.postings) {
        const tdsSection = (p.metadata as { tds_section?: string } | undefined)?.tds_section;
        const tdsAmt = (p.metadata as { tds_amount_paise?: string } | undefined)?.tds_amount_paise;
        if (tdsSection && tdsSection !== 'none' && (!tdsAmt || BigInt(tdsAmt) === 0n)) {
          return {
            code: 'tds_missing',
            severity: rule.severity,
            message: `Vendor bill carries TDS section "${tdsSection}" but no TDS amount captured.`,
            detail: { section: tdsSection },
          };
        }
      }
      return null;
    }

    case 'tds_threshold_crossed': {
      // For vendor_bill: look up cumulative base for this vendor +
      // section + FY via vw_tds_vendor_fy_cumulative. If the
      // captured TDS section has a configured threshold and the
      // cumulative (after this bill) crosses it, warn.
      if (inputs.kind !== 'vendor_bill' || !template.paidToVendorId) return null;
      for (const p of template.postings) {
        const meta = p.metadata as
          | { tds_section?: string; bill_subtotal_paise?: string }
          | undefined;
        if (!meta?.tds_section || meta.tds_section === 'none') continue;
        const billBase = BigInt(meta.bill_subtotal_paise ?? '0');
        // Fiscal year: Apr starts, so May 2026 → FY 2027.
        const [y, m] = template.txnDate.split('-').map(Number) as [number, number];
        const fy = m >= 4 ? y + 1 : y;
        const cumRow = await client.execute<{
          cumulative_base_paise: string;
          threshold_fy_paise: string | null;
        }>(sql`
          SELECT
            COALESCE(v.cumulative_base_paise, 0)::text AS cumulative_base_paise,
            (s.threshold_fy_paise)::text AS threshold_fy_paise
          FROM tds_reference_sections s
          LEFT JOIN vw_tds_vendor_fy_cumulative v
            ON v.vendor_id = ${template.paidToVendorId}
            AND v.section = s.code
            AND v.fiscal_year = ${fy}
          WHERE s.code = ${meta.tds_section}
          LIMIT 1
        `);
        const cumStr = Array.isArray(cumRow) ? cumRow[0]?.cumulative_base_paise : '0';
        const thresStr = Array.isArray(cumRow) ? cumRow[0]?.threshold_fy_paise : null;
        if (thresStr === null || thresStr === undefined) continue;
        const cumulative = BigInt(cumStr ?? '0');
        const threshold = BigInt(thresStr);
        if (threshold > 0n && cumulative + billBase > threshold) {
          return {
            code: 'tds_threshold_crossed',
            severity: rule.severity,
            message: `Vendor cumulative under TDS section ${meta.tds_section} would cross FY threshold (₹${threshold / 100n}) after this bill.`,
            detail: {
              section: meta.tds_section,
              cumulative_paise: cumulative.toString(),
              this_bill_paise: billBase.toString(),
              threshold_paise: threshold.toString(),
            },
          };
        }
      }
      return null;
    }

    // subledger_entity_archived and other rules land in their own
    // follow-up commits.
    default:
      return null;
  }
}
