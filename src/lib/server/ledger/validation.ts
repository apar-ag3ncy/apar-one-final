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

    // gst_rate_mismatch / tds_missing / tds_threshold_crossed /
    // subledger_entity_archived land when enabled — handlers will be
    // added in their own follow-up commits.
    default:
      return null;
  }
}
