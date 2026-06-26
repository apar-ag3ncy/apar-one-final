import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { InterBankTransferForm } from './inter-bank-transfer-form';

export const metadata: Metadata = { title: 'Inter-bank transfer · Apar Dashboard' };

export default function InterBankTransferPage() {
  return (
    <>
      <ProfileHeader
        title="Inter-bank transfer"
        subtitle="Sweep between two agency bank accounts. Single transaction = two postings (1100/1110/1150 ↔ another)."
        back={{ href: '/ledger', label: 'Ledger' }}
      />
      <InterBankTransferForm />
    </>
  );
}
