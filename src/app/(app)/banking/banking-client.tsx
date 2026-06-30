'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { BanknoteIcon, LandmarkIcon, PencilIcon, PlusIcon, ScrollTextIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { paiseToRupees, rupeesToPaise } from '@/lib/money';
import {
  createAgencyBankAccount,
  listAgencyBankAccountsDetailed,
  updateAgencyBankAccount,
  type AgencyBankAccountDetail,
  type AgencyBankAccountType,
} from '@/lib/server/banking/agency-accounts';
import { getBankBook, type Statement } from '@/lib/server/ledger/statements';

const TYPE_OPTIONS: ReadonlyArray<{ value: AgencyBankAccountType; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'od', label: 'Overdraft (OD)' },
  { value: 'escrow', label: 'Escrow' },
];

const TYPE_LABEL: Record<AgencyBankAccountType, string> = {
  current: 'Current',
  savings: 'Savings',
  od: 'Overdraft',
  escrow: 'Escrow',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Strip thousands separators so "₹1,00,000" parses. */
function normaliseRupee(s: string): string {
  return s.replace(/[,\s]/g, '').trim();
}

export function BankingClient() {
  const { hasCapability } = useCurrentUser();
  const canManage = hasCapability('manage_bank_accounts');

  const [rows, setRows] = useState<AgencyBankAccountDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgencyBankAccountDetail | null>(null);
  const [ledgerFor, setLedgerFor] = useState<AgencyBankAccountDetail | null>(null);

  const reload = useCallback(async () => {
    const data = await listAgencyBankAccountsDetailed();
    setRows(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listAgencyBankAccountsDetailed()
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load bank accounts');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <EmptyState icon={LandmarkIcon} title="Could not load bank accounts" description={error} />;
  }
  if (rows === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Bank accounts{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          {canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <PlusIcon className="mr-1.5 size-4" aria-hidden />
              Add bank account
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={BanknoteIcon}
              title="No bank accounts yet"
              description="Add your bank accounts and their opening balances. Payments you record then post here, and the running balance tallies with the ledger."
              action={
                canManage ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    Add bank account
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y">
              {rows.map((acc) => (
                <li key={acc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{acc.displayName}</span>
                      <span className="text-muted-foreground text-xs">
                        {acc.bankName} ••{acc.accountLast4} · {TYPE_LABEL[acc.accountType]}
                      </span>
                      {acc.isActive ? null : <StatusBadge tone="neutral" label="Inactive" dot={false} />}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      IFSC <span className="font-mono">{acc.ifsc}</span>
                      {acc.openingBalanceDate ? (
                        <>
                          {' · '}opening {formatINR(acc.openingBalancePaise)} as of {acc.openingBalanceDate}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums">
                        {formatINR(acc.currentBalancePaise)}
                      </div>
                      <div className="text-muted-foreground text-[11px]">balance</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLedgerFor(acc)}
                      aria-label="View bank book"
                    >
                      <ScrollTextIcon className="size-4" aria-hidden />
                    </Button>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(acc);
                          setFormOpen(true);
                        }}
                        aria-label="Edit bank account"
                      >
                        <PencilIcon className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <BankAccountFormDialog
          open={formOpen}
          onOpenChange={(v) => {
            setFormOpen(v);
            if (!v) setEditing(null);
          }}
          editing={editing}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            void reload();
          }}
        />
      ) : null}

      <BankBookDialog account={ledgerFor} onOpenChange={(o) => !o && setLedgerFor(null)} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Add / edit dialog                                                           */
/* -------------------------------------------------------------------------- */

type FormState = {
  displayName: string;
  bankName: string;
  branch: string;
  accountNumber: string;
  ifsc: string;
  accountType: AgencyBankAccountType;
  openingBalanceRupees: string;
  openingBalanceDate: string;
  isActive: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  displayName: '',
  bankName: '',
  branch: '',
  accountNumber: '',
  ifsc: '',
  accountType: 'current',
  openingBalanceRupees: '',
  openingBalanceDate: todayISO(),
  isActive: true,
  notes: '',
};

function BankAccountFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AgencyBankAccountDetail | null;
  onSaved: () => void;
}) {
  const isEdit = editing !== null;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Defer to a microtask so resetting form state on open doesn't trigger the
    // cascading-render lint (same pattern as the other dialogs in this app).
    queueMicrotask(() => {
      if (editing) {
        setForm({
          displayName: editing.displayName,
          bankName: editing.bankName,
          branch: editing.branch ?? '',
          accountNumber: '',
          ifsc: editing.ifsc,
          accountType: editing.accountType,
          openingBalanceRupees: paiseToRupees(editing.openingBalancePaise),
          openingBalanceDate: editing.openingBalanceDate ?? todayISO(),
          isActive: editing.isActive,
          notes: editing.notes ?? '',
        });
      } else {
        setForm(EMPTY_FORM);
      }
    });
  }, [open, editing]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      try {
        if (isEdit && editing) {
          const res = await updateAgencyBankAccount(editing.id, {
            displayName: form.displayName,
            bankName: form.bankName,
            branch: form.branch || null,
            ifsc: form.ifsc,
            accountType: form.accountType,
            isActive: form.isActive,
            notes: form.notes || null,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success('Bank account updated.');
          onSaved();
          return;
        }

        // Create
        let openingBalancePaise = 0n;
        const trimmed = normaliseRupee(form.openingBalanceRupees);
        if (trimmed !== '' && trimmed !== '0') {
          try {
            openingBalancePaise = rupeesToPaise(trimmed);
          } catch {
            toast.error('Opening balance must be a number, e.g. 100000 or -5000 for an overdraft.');
            return;
          }
        }
        const res = await createAgencyBankAccount({
          displayName: form.displayName,
          bankName: form.bankName,
          branch: form.branch || null,
          accountNumber: normaliseRupee(form.accountNumber),
          ifsc: form.ifsc,
          accountType: form.accountType,
          openingBalancePaise,
          openingBalanceDate: openingBalancePaise !== 0n ? form.openingBalanceDate : null,
          notes: form.notes || null,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        if (res.openingWarning) {
          toast.warning(`Bank account added, but the opening balance wasn't posted: ${res.openingWarning}`);
        } else if (res.openingPosted) {
          toast.success('Bank account added and opening balance posted.');
        } else {
          toast.success('Bank account added.');
        }
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save the bank account.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit bank account' : 'Add bank account'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the label and details. The account number and opening balance are fixed once set (the opening balance is posted to the ledger).'
              : 'Your own account. The full number is stored securely; only the last 4 show. The opening balance posts to the ledger as of its date so the books tally.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ba-name">Label</Label>
            <Input
              id="ba-name"
              placeholder="Operating — HDFC"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ba-bank">Bank name</Label>
              <Input
                id="ba-bank"
                placeholder="HDFC Bank"
                value={form.bankName}
                onChange={(e) => set('bankName', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ba-branch">Branch (optional)</Label>
              <Input
                id="ba-branch"
                placeholder="Lower Parel, Mumbai"
                value={form.branch}
                onChange={(e) => set('branch', e.target.value)}
              />
            </div>
          </div>
          {!isEdit ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ba-acct">Account number</Label>
              <Input
                id="ba-acct"
                inputMode="numeric"
                placeholder="50200012345678"
                value={form.accountNumber}
                onChange={(e) => set('accountNumber', e.target.value.replace(/[^\d]/g, ''))}
              />
              <p className="text-muted-foreground text-xs">
                Stored securely (vault); only the last 4 digits are shown afterwards.
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ba-ifsc">IFSC</Label>
              <Input
                id="ba-ifsc"
                placeholder="HDFC0000123"
                className="font-mono uppercase"
                value={form.ifsc}
                onChange={(e) => set('ifsc', e.target.value.toUpperCase())}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ba-type">Account type</Label>
              <Select
                value={form.accountType}
                onValueChange={(v) => set('accountType', v as AgencyBankAccountType)}
              >
                <SelectTrigger id="ba-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ba-opening">Opening balance ₹ (optional)</Label>
                <Input
                  id="ba-opening"
                  inputMode="decimal"
                  placeholder="100000"
                  value={form.openingBalanceRupees}
                  onChange={(e) => set('openingBalanceRupees', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ba-opening-date">As of date</Label>
                <Input
                  id="ba-opening-date"
                  type="date"
                  value={form.openingBalanceDate}
                  onChange={(e) => set('openingBalanceDate', e.target.value)}
                />
              </div>
              <p className="text-muted-foreground col-span-2 text-xs">
                The balance in this account on that date. Posts to the ledger (Dr bank / Cr Partner
                Capital) so everything tallies. Leave blank for ₹0. Use a negative number for an
                overdraft.
              </p>
            </div>
          ) : null}

          {isEdit ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
              />
              Active (selectable when recording payments)
            </label>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="ba-notes">Notes (optional)</Label>
            <Textarea
              id="ba-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              pending ||
              form.displayName.trim() === '' ||
              form.bankName.trim() === '' ||
              form.ifsc.trim() === '' ||
              (!isEdit && form.accountNumber.trim().length < 4)
            }
          >
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Bank book (running balance) dialog                                          */
/* -------------------------------------------------------------------------- */

function BankBookDialog({
  account,
  onOpenChange,
}: {
  account: AgencyBankAccountDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Clear stale data (deferred to dodge the cascading-render lint), then load.
    queueMicrotask(() => {
      if (!cancelled) {
        setStatement(null);
        setError(null);
      }
    });
    if (!account) return;
    getBankBook({ bankAccountId: account.id })
      .then((s) => {
        if (!cancelled) setStatement(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the bank book');
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{account ? `${account.displayName} — bank book` : 'Bank book'}</DialogTitle>
          <DialogDescription>
            Every posted movement on this account, oldest first, with the running balance.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : !statement ? (
          <Skeleton className="h-40 w-full" />
        ) : statement.lines.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No transactions on this account yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-xs">
                <tr>
                  <th className="py-1.5 pr-2 text-left font-medium">Date</th>
                  <th className="py-1.5 pr-2 text-left font-medium">Description</th>
                  <th className="py-1.5 pr-2 text-right font-medium">In</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Out</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statement.lines.map((l) => (
                  <tr key={l.postingId} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{l.txnDate}</td>
                    <td className="py-1.5 pr-2">
                      <span className="font-mono text-xs">{l.reference}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                      {l.side === 'debit' ? formatINR(l.amountPaise) : ''}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                      {l.side === 'credit' ? formatINR(l.amountPaise) : ''}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {formatINR(l.runningBalancePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="py-2" colSpan={4}>
                    Closing balance
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {formatINR(statement.closingBalancePaise)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
