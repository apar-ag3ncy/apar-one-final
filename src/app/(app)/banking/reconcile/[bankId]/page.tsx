import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ReconcileClient } from './reconcile-client';
import { getReconciliationCandidates } from '@/lib/server-stub/ledger-actions';

export const metadata: Metadata = { title: 'Reconcile · Apar Dashboard' };

type Props = { params: Promise<{ bankId: string }> };

export default async function ReconcilePage({ params }: Props) {
  const { bankId } = await params;
  const candidates = await getReconciliationCandidates({ bankAccountId: bankId });
  return (
    <>
      <ProfileHeader
        title="Bank reconciliation"
        subtitle="Upload the statement, review auto-matches, manually pair anything left over, and create new transactions for bank-side entries (charges, interest) that have no posting yet."
        back={{ href: '/banking/reconcile', label: 'Pick another bank' }}
      />
      <ReconcileClient bankId={bankId} initialRows={candidates} />
    </>
  );
}
