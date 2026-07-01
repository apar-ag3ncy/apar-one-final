'use client';

// Smart wrapper around <BankAccountList /> — fetches via listBankAccounts and
// owns the add/edit dialog and the delete confirmation, plus the audit-logged
// reveal flow through revealBank (lib/server-stub/entity-actions, which
// delegates to lib/storage.ts:revealBank — 60s signed URL, audit + activity
// log). Mirrors AddressesSection so Client / Vendor / Employee windows drop it
// in by entity-type alone.
//
// `canReveal` flips on the current user's `reveal_bank` capability and
// `canManage` on the entity's update capability (`update_client`, …); the
// matching affordances are hidden entirely when missing, per CLAUDE rule #33.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BankAccountList, type BankAccount } from './bank-account-list';
import { BankAccountForm, type BankAccountFormValues } from './bank-account-form';
import {
  createBankAccount,
  listBankAccounts,
  softDeleteBankAccount,
  updateBankAccount,
  type BankAccountEntityType,
  type BankAccountRow,
} from '@/lib/server/entities/bank-accounts';
import { revealBank as revealBankAction } from '@/lib/server-stub/entity-actions';
import { useCurrentUser } from '@/lib/client/use-current-user';

/** Capability that gates add / edit / remove for each entity type. */
const MANAGE_CAP: Record<BankAccountEntityType, string> = {
  client: 'update_client',
  vendor: 'update_vendor',
  employee: 'update_employee',
  project: 'update_client',
  office: 'update_client',
};

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
  const canManage = hasCapability(MANAGE_CAP[entityType]);

  const [rows, setRows] = useState<readonly BankAccountRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccountRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BankAccountRow | null>(null);

  // Stable identity for the form's initial values so BankAccountForm's reset
  // effect (keyed on `initial`) only fires when the edited row changes.
  const initialForForm = useMemo(
    () =>
      editing
        ? {
            holderName: editing.holderName,
            ifsc: editing.ifsc,
            bankName: editing.bankName,
            branch: editing.branch,
            accountType: editing.accountType,
            isPrimary: editing.isPrimary,
            notes: editing.notes,
          }
        : undefined,
    [editing],
  );

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

  async function handleSubmit(values: BankAccountFormValues) {
    if (editing) {
      const updated = await updateBankAccount(editing.id, {
        holderName: values.holderName,
        ifsc: values.ifsc,
        bankName: values.bankName,
        branch: values.branch || null,
        accountType: values.accountType,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setRows((prev) => {
          if (!prev) return prev;
          const next = prev.map((r) => (r.id === updated.id ? updated : r));
          if (updated.isPrimary) {
            return next.map((r) => (r.id === updated.id ? r : { ...r, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Bank account updated.');
    } else {
      const created = await createBankAccount({
        entityType,
        entityId,
        holderName: values.holderName,
        accountNumber: (values.accountNumber ?? '').trim(),
        ifsc: values.ifsc,
        bankName: values.bankName,
        branch: values.branch || null,
        accountType: values.accountType,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setRows((prev) => {
          const base = prev ?? [];
          const next = [...base, created];
          if (created.isPrimary) {
            return next.map((r) => (r.id === created.id ? r : { ...r, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Bank account added.');
    }
    setEditing(null);
  }

  async function handleSoftDelete(r: BankAccountRow) {
    try {
      await softDeleteBankAccount(r.id);
      startTransition(() => {
        setRows((prev) => (prev ? prev.filter((row) => row.id !== r.id) : prev));
      });
      toast.success('Bank account removed.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not remove bank account.';
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  }

  if (err) {
    return <p style={{ color: 'var(--text-error, #c33)', fontSize: 13, margin: 0 }}>{err}</p>;
  }
  if (!rows) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading bank accounts…</p>
    );
  }

  return (
    <>
      <BankAccountList
        accounts={rows.map(rowToView)}
        entityName={entityName}
        canReveal={hasCapability('reveal_bank')}
        onReveal={(accountId) => revealBankAction(accountId)}
        onAdd={
          canManage
            ? () => {
                setEditing(null);
                setFormOpen(true);
              }
            : undefined
        }
        onEdit={
          canManage
            ? (a) => {
                const row = rows.find((x) => x.id === a.id);
                if (!row) return;
                setEditing(row);
                setFormOpen(true);
              }
            : undefined
        }
        onDelete={
          canManage
            ? (a) => {
                const row = rows.find((x) => x.id === a.id);
                if (!row) return;
                setPendingDelete(row);
              }
            : undefined
        }
      />

      {canManage ? (
        <BankAccountForm
          open={formOpen}
          onOpenChange={(v) => {
            setFormOpen(v);
            if (!v) setEditing(null);
          }}
          mode={editing ? 'edit' : 'create'}
          initial={initialForForm}
          entityName={entityName}
          onSubmit={handleSubmit}
        />
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank account?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  <strong>{pendingDelete.bankName}</strong>
                  {` · ${pendingDelete.holderName} · XXXX ${pendingDelete.accountLast4}`}
                  <br />
                </>
              ) : null}
              Removing archives the account — it stays queryable but is hidden from this list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && handleSoftDelete(pendingDelete)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
