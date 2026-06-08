'use client';

// Transaction-detail window body — Phase 4.2.
//
// Embeds B's `<TransactionDetail>` and renders the first attached source
// document inline via `<DocumentViewer>` so the OS shows postings + source
// side by side without a second window.
//
// Data flows through `useTransaction(id)` from `lib/os/data-providers`.
// Today the provider returns `null` (no backend); once A ships
// `getTransaction`, the swap is one line in the provider.

import { TransactionDetail } from '@/components/entity/transaction-detail';
import { DocumentViewer } from '@/components/entity/document-viewer';
import { resolveDocumentUrl, useTransaction } from '@/lib/os/data-providers';
import { navigateBesideFocused } from './navigate';

export type TransactionDetailWindowProps = {
  /** Transaction id encoded as the window's `entityId`. */
  transactionId: string | undefined;
};

export function TransactionDetailWindow({ transactionId }: TransactionDetailWindowProps) {
  const { data: transaction } = useTransaction(transactionId);
  if (!transaction) {
    return (
      <div
        className="main"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>Transaction not found</div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
            This transaction may have been reversed or removed. Open one from a ledger or from a
            client / vendor / project Transactions tab to see its double-entry postings and the
            linked source document inline.
          </div>
        </div>
      </div>
    );
  }

  const firstDocId = transaction.sourceDocumentIds?.[0];

  return (
    <div className="main" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <TransactionDetail
        transaction={transaction}
        onNavigate={navigateBesideFocused}
        sourceDocumentSlot={
          firstDocId ? (
            <DocumentViewer
              documentId={firstDocId}
              name={transaction.reference}
              // Best-effort default — real consumers should read MIME from
              // the resolver below. Set here so the inline preview chooses
              // PDF.js by default; images/HTML override via the resolver.
              mimeType="application/pdf"
              onResolveUrl={resolveDocumentUrl}
            />
          ) : null
        }
      />
    </div>
  );
}
