'use client';

// Bank reconciliation window — 1200×800 default per the brief.
// Two-pane layout: imported bank statement lines on the left,
// unreconciled ledger postings on the right, drag-to-match between them.
//
// The window scaffolding (chrome, sizing, focus, drag) is the OS's job
// and lives here. The unreconciled postings pane reuses B's shared
// <TransactionList> so the row chrome matches every other ledger surface
// (Rule 47). Bank-statement lines stay local until the importer ships.

import { TransactionList } from '@/components/entity/transaction-list';
import { navigateBesideFocused } from './navigate';

export type BankReconWindowProps = {
  /** Optional bank-account id, encoded in the window URL as the `entityId`. */
  bankAccountId?: string;
};

export function BankReconWindow({ bankAccountId }: BankReconWindowProps) {
  return (
    <div
      className="main"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1,
        background: 'var(--border)',
        flex: 1,
      }}
    >
      <Pane
        title="Statement lines"
        sub={bankAccountId ? `Account ${bankAccountId}` : 'No account selected'}
        body={
          <EmptyMessage
            heading="Upload a bank statement"
            body={
              <>
                Drag a CSV / OFX statement here, or wire the statement-import action once{' '}
                <code>importBankStatement</code> ships.
              </>
            }
          />
        }
      />
      <Pane
        title="Unreconciled postings"
        sub="From the ledger"
        body={
          // Empty shared list — uses the same chrome as every other
          // transactions surface. Once the backend supplies real
          // unreconciled postings, swap the [] for the loaded set.
          <TransactionList transactions={[]} scope="all" onNavigate={navigateBesideFocused} />
        }
      />
    </div>
  );
}

function Pane({ title, sub, body }: { title: string; sub: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        minWidth: 0,
      }}
    >
      <div className="main-header" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2>{title}</h2>
        <span className="sub">{sub}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>{body}</div>
    </div>
  );
}

function EmptyMessage({ heading, body }: { heading: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{heading}</div>
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}
