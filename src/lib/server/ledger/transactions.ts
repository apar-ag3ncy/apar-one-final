import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { logActivity } from '@/lib/activity';
import { logAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db/client';
import { accounts } from '@/lib/db/schema/accounts';
import { periods } from '@/lib/db/schema/periods';
import { postings, transactions } from '@/lib/db/schema/transactions';
import { AppError } from '@/lib/errors';
import { hasCapability, requireCapability, type CurrentUserContext } from '@/lib/rbac';

import { runValidations } from './validation';
import type { PostingTemplateResult } from './types';

import {
  clientAdvanceReceived,
  type ClientAdvanceReceivedInput,
} from './postings/clientAdvanceReceived';
import { clientInvoice, type ClientInvoiceInput } from './postings/clientInvoice';
import {
  clientPaymentReceived,
  type ClientPaymentReceivedInput,
} from './postings/clientPaymentReceived';
import {
  employeeReimbursement,
  type EmployeeReimbursementInput,
} from './postings/employeeReimbursement';
import { expenseOnBehalf, type ExpenseOnBehalfInput } from './postings/expenseOnBehalf';
import { interBankTransfer, type InterBankTransferInput } from './postings/interBankTransfer';
import { journal, type JournalInput } from './postings/journal';
import { officeExpense, type OfficeExpenseInput } from './postings/officeExpense';
import { partnerEquity, type PartnerEquityInput } from './postings/partnerEquity';
import { salaryDisbursement, type SalaryDisbursementInput } from './postings/salaryDisbursement';
import { vendorBill, type VendorBillInput } from './postings/vendorBill';
import { vendorPaymentMade, type VendorPaymentMadeInput } from './postings/vendorPaymentMade';

/**
 * Ledger orchestrator. Application surface for all ledger writes:
 *   - createDraftTransaction(kind, input)
 *   - postTransaction(id, acknowledgedFlags)
 *   - reverseTransaction(id, reason)
 *
 * All three: capability-gated, audit + activity logged.
 */

export type TransactionKindInput =
  | { kind: 'client_invoice'; input: ClientInvoiceInput }
  | { kind: 'client_payment_received'; input: ClientPaymentReceivedInput }
  | { kind: 'client_advance_received'; input: ClientAdvanceReceivedInput }
  | { kind: 'vendor_bill'; input: VendorBillInput }
  | { kind: 'vendor_payment_made'; input: VendorPaymentMadeInput }
  | { kind: 'expense_on_behalf'; input: ExpenseOnBehalfInput }
  | { kind: 'employee_reimbursement'; input: EmployeeReimbursementInput }
  | { kind: 'office_expense'; input: OfficeExpenseInput }
  | { kind: 'inter_bank_transfer'; input: InterBankTransferInput }
  | { kind: 'partner_capital'; input: PartnerEquityInput }
  | { kind: 'partner_drawing'; input: PartnerEquityInput }
  | { kind: 'salary_disbursement'; input: SalaryDisbursementInput }
  | { kind: 'journal'; input: JournalInput };

function buildTemplate(kindInput: TransactionKindInput): PostingTemplateResult {
  switch (kindInput.kind) {
    case 'client_invoice':
      return clientInvoice(kindInput.input);
    case 'client_payment_received':
      return clientPaymentReceived(kindInput.input);
    case 'client_advance_received':
      return clientAdvanceReceived(kindInput.input);
    case 'vendor_bill':
      return vendorBill(kindInput.input);
    case 'vendor_payment_made':
      return vendorPaymentMade(kindInput.input);
    case 'expense_on_behalf':
      return expenseOnBehalf(kindInput.input);
    case 'employee_reimbursement':
      return employeeReimbursement(kindInput.input);
    case 'office_expense':
      return officeExpense(kindInput.input);
    case 'inter_bank_transfer':
      return interBankTransfer(kindInput.input);
    case 'partner_capital':
      return partnerEquity({ ...kindInput.input, kind: 'capital' });
    case 'partner_drawing':
      return partnerEquity({ ...kindInput.input, kind: 'drawing' });
    case 'salary_disbursement':
      return salaryDisbursement(kindInput.input);
    case 'journal':
      return journal(kindInput.input);
  }
}

export type CreateDraftResult = {
  transactionId: string;
  validationFlags: Array<{ code: string; severity: string; message: string }>;
};

export async function createDraftTransaction(
  ctx: CurrentUserContext,
  kindInput: TransactionKindInput,
  client: DbClient = db,
): Promise<CreateDraftResult> {
  if (kindInput.kind === 'journal') {
    requireCapability(ctx, 'create_journal_voucher');
  }

  const template = buildTemplate(kindInput);
  const attribution =
    kindInput.kind === 'vendor_bill' ? (kindInput.input as VendorBillInput).attribution : undefined;

  const flags = await runValidations(template, { kind: kindInput.kind, attribution }, client);

  const txnId = await client.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        kind: kindInput.kind,
        externalRef: template.externalRef,
        description: template.description,
        txnDate: template.txnDate,
        status: 'draft',
        sourceKind: template.sourceKind,
        sourceDocumentId: template.sourceDocumentId,
        relatedEntityKind: template.relatedEntityKind,
        relatedEntityId: template.relatedEntityId,
        onBehalfOfClientId: template.onBehalfOfClientId,
        paidToVendorId: template.paidToVendorId,
        incurredByEmployeeId: template.incurredByEmployeeId,
        projectId: template.projectId,
        validationFlags: flags,
        notes: template.notes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: transactions.id });
    if (!row) {
      throw new AppError('internal', 'transactions.insert returned no row');
    }

    const codes = Array.from(new Set(template.postings.map((p) => p.accountCode)));
    // Drizzle's sql tag interpolates a JS array as a row constructor
    // ($1, $2, $3), which makes `ANY ((...))` blow up with the
    // "input syntax for type integer/text" error the user hit. inArray()
    // emits the right `code = ANY ($1::text[])` shape with a single
    // array parameter.
    const accountRows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(inArray(accounts.code, codes));
    const codeToId = new Map(accountRows.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!codeToId.has(code)) {
        throw new AppError('ledger.control_violation', `account code "${code}" not found`);
      }
    }

    for (const p of template.postings) {
      await tx.insert(postings).values({
        transactionId: row.id,
        accountId: codeToId.get(p.accountCode)!,
        subledgerEntityType: p.subledger?.entityType,
        subledgerEntityId: p.subledger?.entityId,
        side: p.side,
        amountPaise: p.amountPaise,
        currency: 'INR',
        metadata: p.metadata ?? {},
      });
    }
    return row.id as string;
  });

  return {
    transactionId: txnId,
    validationFlags: flags.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
  };
}

export async function postTransaction(
  ctx: CurrentUserContext,
  args: { transactionId: string; acknowledgedFlags?: string[] },
  client: DbClient = db,
): Promise<{ transactionId: string }> {
  requireCapability(ctx, 'post_transaction');

  await client.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: transactions.id,
        status: transactions.status,
        validationFlags: transactions.validationFlags,
        externalRef: transactions.externalRef,
        kind: transactions.kind,
        onBehalfOfClientId: transactions.onBehalfOfClientId,
        paidToVendorId: transactions.paidToVendorId,
        periodId: transactions.periodId,
      })
      .from(transactions)
      .where(eq(transactions.id, args.transactionId))
      .limit(1);
    if (!row) {
      throw new AppError('not_found', `transaction ${args.transactionId} not found`);
    }
    if (row.status !== 'draft') {
      throw new AppError(
        'ledger.posted_immutable',
        `transaction ${args.transactionId} is ${row.status}, not draft`,
      );
    }

    // P1.2 — period close enforcement. `period_id` is populated by the
    // tg_assign_transaction_period trigger on insert (drizzle/0007). A
    // missing period_id means the trigger refused — surface that, but
    // it should never happen because the trigger raises on insert.
    if (!row.periodId) {
      throw new AppError(
        'ledger.period_closed',
        `transaction ${args.transactionId} has no period assigned`,
      );
    }
    const [period] = await tx
      .select({
        id: periods.id,
        status: periods.status,
        fiscalYear: periods.fiscalYear,
        month: periods.month,
      })
      .from(periods)
      .where(eq(periods.id, row.periodId))
      .limit(1);
    if (!period) {
      throw new AppError(
        'ledger.period_closed',
        `period ${row.periodId} not found for transaction ${args.transactionId}`,
      );
    }
    if (period.status === 'closed') {
      throw new AppError(
        'ledger.period_closed',
        `Period FY${period.fiscalYear}-${String(period.month).padStart(2, '0')} is hard-closed; ` +
          `reopen it before posting into it.`,
        { detail: { periodId: period.id, status: period.status } },
      );
    }
    if (period.status === 'soft_closed' && !hasCapability(ctx, 'close_period')) {
      throw new AppError(
        'ledger.period_closed',
        `Period FY${period.fiscalYear}-${String(period.month).padStart(2, '0')} is soft-closed; ` +
          `posting into it requires the close_period capability (admins/partners).`,
        { detail: { periodId: period.id, status: period.status } },
      );
    }

    const flags = (row.validationFlags as Array<{ code: string; severity: string }>) ?? [];
    const blockUnacked = flags.filter(
      (f) => f.severity === 'block' && !(args.acknowledgedFlags ?? []).includes(f.code),
    );
    if (blockUnacked.length > 0) {
      throw new AppError(
        'validation',
        `Unacknowledged block-severity flags: ${blockUnacked.map((f) => f.code).join(', ')}`,
        { detail: { unacknowledged: blockUnacked } },
      );
    }

    await tx
      .update(transactions)
      .set({
        status: 'posted',
        postedAt: new Date(),
        postedBy: ctx.userId,
        validationAcknowledgedBy: args.acknowledgedFlags?.length ? ctx.userId : undefined,
        validationAcknowledgedAt: args.acknowledgedFlags?.length ? new Date() : undefined,
        updatedBy: ctx.userId,
      })
      .where(eq(transactions.id, args.transactionId));

    const primaryEntity = row.paidToVendorId
      ? { entityType: 'vendor' as const, entityId: row.paidToVendorId }
      : row.onBehalfOfClientId
        ? { entityType: 'client' as const, entityId: row.onBehalfOfClientId }
        : null;

    if (primaryEntity) {
      const mentions: Array<{ entityType: string; entityId: string }> = [];
      if (row.onBehalfOfClientId && primaryEntity.entityType !== 'client') {
        mentions.push({ entityType: 'client', entityId: row.onBehalfOfClientId });
      }
      await logActivity(
        {
          entityType: primaryEntity.entityType,
          entityId: primaryEntity.entityId,
          actorId: ctx.userId,
          kind: 'transaction.posted',
          summary: `${row.kind} posted (${row.externalRef})`,
          payload: {
            transaction_id: row.id,
            external_ref: row.externalRef,
            mentions,
          },
        },
        tx as unknown as DbClient,
      );
    }

    await logAudit(
      {
        actorId: ctx.userId,
        entityType: 'transaction',
        entityId: row.id,
        action: 'update',
        changes: { status: { before: 'draft', after: 'posted' } },
      },
      tx as unknown as DbClient,
    );
  });

  return { transactionId: args.transactionId };
}

export async function reverseTransaction(
  ctx: CurrentUserContext,
  args: { transactionId: string; reason: string },
  client: DbClient = db,
): Promise<{ reversalTransactionId: string }> {
  requireCapability(ctx, 'reverse_transaction');
  if (args.reason.trim().length < 10) {
    throw new AppError('validation', 'Reversal reason must be ≥10 characters.');
  }

  const reversalId = await client.transaction(async (tx) => {
    const [original] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, args.transactionId))
      .limit(1);
    if (!original) {
      throw new AppError('not_found', `transaction ${args.transactionId} not found`);
    }
    if (original.status !== 'posted') {
      throw new AppError('validation', `cannot reverse transaction in status ${original.status}`);
    }

    const originalPostings = await tx
      .select()
      .from(postings)
      .where(eq(postings.transactionId, original.id));

    const reversalExternalRef = `${original.externalRef}:REV:${Date.now()}`;
    const [rev] = await tx
      .insert(transactions)
      .values({
        kind: original.kind,
        externalRef: reversalExternalRef,
        description: `Reversal of ${original.externalRef}: ${args.reason}`,
        txnDate: original.txnDate,
        status: 'posted',
        postedAt: new Date(),
        postedBy: ctx.userId,
        reversesId: original.id,
        sourceKind: 'journal',
        // Reuse the original's source document. Setting null violates
        // transactions_source_document_required for any kind that isn't
        // journal/inter_bank_transfer (e.g. reversing a vendor_payment_made or
        // an invoice), so a reversal must carry the same doc the original did.
        sourceDocumentId: original.sourceDocumentId,
        relatedEntityKind: original.relatedEntityKind,
        relatedEntityId: original.relatedEntityId,
        onBehalfOfClientId: original.onBehalfOfClientId,
        paidToVendorId: original.paidToVendorId,
        incurredByEmployeeId: original.incurredByEmployeeId,
        projectId: original.projectId,
        notes: args.reason,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: transactions.id });
    if (!rev) {
      throw new AppError('internal', 'reversal transactions.insert returned no row');
    }

    for (const p of originalPostings) {
      await tx.insert(postings).values({
        transactionId: rev.id,
        accountId: p.accountId,
        subledgerEntityType: p.subledgerEntityType,
        subledgerEntityId: p.subledgerEntityId,
        side: p.side === 'debit' ? 'credit' : 'debit',
        amountPaise: p.amountPaise,
        currency: p.currency,
        metadata: { ...(p.metadata as object), reverses_posting_id: p.id },
      });
    }

    await tx
      .update(transactions)
      .set({
        status: 'reversed',
        reversedAt: new Date(),
        reversedBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .where(eq(transactions.id, original.id));

    await logActivity(
      {
        entityType: original.relatedEntityKind ?? 'office',
        entityId: original.relatedEntityId ?? original.id,
        actorId: ctx.userId,
        kind: 'transaction.reversed',
        summary: `Reversed ${original.externalRef}: ${args.reason}`,
        payload: {
          original_transaction_id: original.id,
          reversal_transaction_id: rev.id,
          reason: args.reason,
        },
      },
      tx as unknown as DbClient,
    );

    return rev.id as string;
  });

  return { reversalTransactionId: reversalId };
}
