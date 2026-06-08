'use client';

// Bank reconciliation window.
//
// The statement importer + drag-to-match reconciliation engine are not built
// yet (no `importBankStatement` action, no unreconciled-postings query). Rather
// than show a fake two-pane reconcile UI with hardcoded-empty data — which reads
// as "broken" — this surfaces an honest "not available yet" state. Swap this for
// the real two-pane layout once the backend ships.

export type BankReconWindowProps = {
  /** Optional bank-account id, encoded in the window URL as the `entityId`. */
  bankAccountId?: string;
};

export function BankReconWindow(_props: BankReconWindowProps) {
  return (
    <div
      className="main"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          Bank reconciliation is coming soon
        </div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
          Statement import (CSV / OFX) and drag-to-match reconciliation against ledger postings
          aren&apos;t available yet. In the meantime, post and review bank transactions from the{' '}
          <strong style={{ color: 'var(--text)' }}>Ledger</strong>, and use the{' '}
          <strong style={{ color: 'var(--text)' }}>Bank Book</strong> report for running balances.
        </div>
      </div>
    </div>
  );
}
