'use client';

// Smart wrapper around <BankAccountList /> — fetches via
// listBankAccounts and wires the audit-logged reveal flow through
// revealBank (lib/server-stub/entity-actions, which delegates to
// lib/storage.ts:revealBank — 60s signed URL, audit + activity log).
//
// `canReveal` flips on the current user's `reveal_bank` capability —
// hidden entirely when missing, per CLAUDE rule #33 + SPEC §3.

import { useEffect, useState } from 'react';

import { BankAccountList, type BankAccount } from './bank-account-list';
import {
  listBankAccounts,
  type BankAccountEntityType,
  type BankAccountRow,
} from '@/lib/server/entities/bank-accounts';
import { revealBank as revealBankAction } from '@/lib/server-stub/entity-actions';
import { useCurrentUser } from '@/lib/client/use-current-user';

function rowToView(r: BankAccountRow): BankAccount {
  return {
    id: r.id,
    bankName: r.bankName,
    maskedNumber: `XXXX XXXX ${r.accountLast4}`,
    ifsc: r.ifsc,
    holderName: r.holderName,
    accountType: r.accountType,
    isPrimary: r.isPrimary,
    branch: r.branch,
  };
}

export type BankAccountsSectionProps = {
  entityType: BankAccountEntityType;
  entityId: string;
  entityName?: string;
};

export function BankAccountsSection({
  entityType,
  entityId,
  entityName,
}: BankAccountsSectionProps) {
  const { hasCapability } = useCurrentUser();
  const [rows, setRows] = useState<readonly BankAccountRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBankAccounts({ entityType, entityId })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load bank accounts');
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (err) {
    return <p style={{ color: 'var(--text-error, #c33)', fontSize: 13, margin: 0 }}>{err}</p>;
  }
  if (!rows) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading bank accounts…</p>
    );
  }

  return (
    <BankAccountList
      accounts={rows.map(rowToView)}
      entityName={entityName}
      canReveal={hasCapability('reveal_bank')}
      onReveal={(accountId) => revealBankAction(accountId)}
    />
  );
}
