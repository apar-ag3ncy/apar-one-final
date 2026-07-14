'use client';

// Shared "open an invoice" glue for OS windows (founder change-batch §5).
//
// An invoice reference can be held two ways in the UI:
//   1. by its `invoices` table id (client Invoices tab, project invoice list)
//   2. by its posted ledger transaction id (statements, transaction lists,
//      receipt allocations — all `kind = 'client_invoice'` txns)
//
// Either way, "opening the invoice" resolves to the stored invoice PDF in a
// documents window (same pattern as employee-window's openDocumentBeside).
// When no PDF exists yet we fall back to the posted-transaction window; a
// plain draft (no PDF, no txn) explains itself with a toast.

import { toast } from 'sonner';

import { osActions } from '@/lib/os/store';
import { getInvoice } from '@/lib/server/billing/invoices';
import { getTransaction } from '@/lib/server-stub/entity-actions';

export function openDocumentWindow(documentId: string, title?: string): void {
  osActions.openWindow({
    app: 'documents',
    entityId: documentId,
    title,
    position: 'beside-focused',
  });
}

export function openTransactionWindow(transactionId: string, title?: string): void {
  osActions.openWindow({
    app: 'transactions',
    entityId: transactionId,
    title: title ?? 'Transaction',
    position: 'beside-focused',
  });
}

/**
 * Open an invoice by its `invoices` row id. Sent/paid invoices open their
 * stored PDF; a posted invoice without a PDF opens its ledger transaction
 * (postings + source document side by side); drafts explain themselves.
 */
export async function openInvoiceById(invoiceId: string, documentNumber?: string): Promise<void> {
  try {
    const res = await getInvoice(invoiceId);
    if (!res) {
      toast.error('Invoice not found — it may have been deleted.');
      return;
    }
    const inv = res.invoice;
    if (inv.sourceDocumentId) {
      openDocumentWindow(inv.sourceDocumentId, documentNumber ?? inv.documentNumber);
      return;
    }
    if (inv.postedTransactionId) {
      openTransactionWindow(inv.postedTransactionId, documentNumber ?? inv.documentNumber);
      return;
    }
    toast.info(
      `${inv.documentNumber} is a draft — no PDF yet. Edit it from the client's Invoices tab.`,
    );
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not open the invoice.');
  }
}

/**
 * Open the invoice PDF behind a `client_invoice` ledger transaction; falls
 * back to the plain transaction window when the txn has no source document.
 */
export async function openInvoiceForTransaction(
  transactionId: string,
  documentNumber?: string,
): Promise<void> {
  try {
    const txn = await getTransaction(transactionId);
    const docId = txn?.sourceDocumentIds?.[0];
    if (docId) {
      openDocumentWindow(docId, documentNumber ?? txn?.reference ?? 'Invoice');
      return;
    }
  } catch {
    // Resolution failed — the transaction window can still render the id.
  }
  openTransactionWindow(transactionId, documentNumber);
}

/**
 * Row-click handler for mixed transaction lists / statements: invoice rows
 * open the invoice itself, everything else opens the transaction window.
 */
export function openTransactionOrInvoice(
  transactionId: string,
  kind?: string,
  label?: string,
): void {
  if (kind === 'client_invoice') {
    void openInvoiceForTransaction(transactionId, label);
    return;
  }
  openTransactionWindow(transactionId, label);
}
