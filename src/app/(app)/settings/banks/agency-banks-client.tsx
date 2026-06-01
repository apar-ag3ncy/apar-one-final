'use client';

import { BankAccountList } from '@/components/entity/bank-account-list';
import { revealBank } from '@/lib/server-stub/entity-actions';
import { notify } from '@/lib/client/toast';
import type { BankAccount } from '@/types/api';

export function AgencyBanksClient({ accounts }: { accounts: readonly BankAccount[] }) {
  async function handleReveal(accountId: string) {
    try {
      return await revealBank(accountId);
    } catch (e) {
      notify.error('Reveal not available', e instanceof Error ? e.message : 'Unknown error');
      throw e;
    }
  }

  return (
    <BankAccountList
      accounts={accounts}
      entityName="Apār LLP"
      // TODO(backend): pass canReveal={user.capabilities.has('reveal_bank')}
      // once A ships getCurrentUser. Until then this stays false so the
      // reveal flow doesn't no-op.
      canReveal={false}
      onReveal={handleReveal}
    />
  );
}
