'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PencilIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/shared/status-badge';
import { CopyButton } from '@/components/shared/copy-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { notify } from '@/lib/client/toast';
import {
  createCompanyBankAccount,
  deleteCompanyBankAccount,
  setPrimaryBankAccount,
  updateCompanyBankAccount,
  type BankInputShape,
} from '@/lib/server/settings/company';
import type { CompanyBankAccountRow } from '@/lib/server/settings/company-data';

type FormState = {
  title: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branchName: string;
  upiId: string;
  notes: string;
  isPrimary: boolean;
};

const EMPTY: FormState = {
  title: '',
  accountNumber: '',
  ifsc: '',
  bankName: '',
  branchName: '',
  upiId: '',
  notes: '',
  isPrimary: false,
};

export function BillingSettingsClient({
  accounts,
  onChanged,
}: {
  accounts: readonly CompanyBankAccountRow[];
  /** Called after a successful mutation — lets a client-fetched host (the OS
   *  Settings pane) re-fetch, since router.refresh() only re-runs server
   *  components. The dashboard page relies on router.refresh() alone. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const afterChange = () => {
    router.refresh();
    onChanged?.();
  };
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<CompanyBankAccountRow | null>(null);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY, isPrimary: accounts.length === 0 });
    setDialogOpen(true);
  }

  function openEdit(acc: CompanyBankAccountRow) {
    setEditingId(acc.id);
    setForm({
      title: acc.title,
      accountNumber: acc.accountNumber,
      ifsc: acc.ifsc,
      bankName: acc.bankName,
      branchName: acc.branchName ?? '',
      upiId: acc.upiId ?? '',
      notes: acc.notes ?? '',
      isPrimary: acc.isPrimary,
    });
    setDialogOpen(true);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    const payload: BankInputShape = {
      title: form.title,
      accountNumber: form.accountNumber,
      ifsc: form.ifsc,
      bankName: form.bankName,
      branchName: form.branchName || null,
      upiId: form.upiId || null,
      notes: form.notes || null,
      isPrimary: editingId ? undefined : form.isPrimary,
    };
    startTransition(async () => {
      const result = editingId
        ? await updateCompanyBankAccount(editingId, payload)
        : await createCompanyBankAccount(payload);
      if (result.ok) {
        notify.success(editingId ? 'Bank account updated' : 'Bank account added');
        setDialogOpen(false);
        afterChange();
      } else {
        notify.error('Could not save', result.message);
      }
    });
  }

  function makePrimary(id: string) {
    startTransition(async () => {
      const result = await setPrimaryBankAccount(id);
      if (result.ok) {
        notify.success('Primary account updated');
        afterChange();
      } else {
        notify.error('Could not update', result.message);
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    startTransition(async () => {
      const result = await deleteCompanyBankAccount(id);
      if (result.ok) {
        notify.success('Bank account removed');
        afterChange();
      } else {
        notify.error('Could not remove', result.message);
      }
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {accounts.length === 0
            ? 'No bank accounts yet. Add the accounts Apār invoices payments into.'
            : `${accounts.length} account${accounts.length === 1 ? '' : 's'} · the primary account is offered first on invoices.`}
        </p>
        <Button size="sm" onClick={openCreate} disabled={pending}>
          <PlusIcon className="mr-1 size-4" aria-hidden />
          Add account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Add your first bank account to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {accounts.map((acc) => (
            <Card key={acc.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{acc.title}</span>
                    {acc.isPrimary ? (
                      <StatusBadge tone="success" label="Primary" />
                    ) : (
                      <StatusBadge tone="neutral" label="Secondary" />
                    )}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {acc.bankName}
                    {acc.branchName ? ` · ${acc.branchName}` : ''}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">A/C</span>
                      <span className="font-mono">{acc.accountNumber}</span>
                      <CopyButton value={acc.accountNumber} label="account number" />
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">IFSC</span>
                      <span className="font-mono">{acc.ifsc}</span>
                      <CopyButton value={acc.ifsc} label="IFSC" />
                    </span>
                  </div>
                  {acc.notes ? <p className="text-muted-foreground text-xs">{acc.notes}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!acc.isPrimary ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => makePrimary(acc.id)}
                      disabled={pending}
                    >
                      <StarIcon className="mr-1 size-3.5" aria-hidden />
                      Set primary
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(acc)}
                    disabled={pending}
                  >
                    <PencilIcon className="mr-1 size-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-8"
                    onClick={() => setDeleteTarget(acc)}
                    disabled={pending}
                    aria-label="Remove account"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit bank account' : 'Add bank account'}</DialogTitle>
            <DialogDescription>
              These are Apār&apos;s own accounts. The full number is stored so it can be copied onto
              invoices.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Title" htmlFor="ba-title">
              <Input
                id="ba-title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Operating account"
              />
            </Field>
            <Field label="Account number" htmlFor="ba-acc">
              <Input
                id="ba-acc"
                value={form.accountNumber}
                onChange={(e) => set('accountNumber', e.target.value)}
                className="font-mono"
                inputMode="numeric"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="IFSC" htmlFor="ba-ifsc">
                <Input
                  id="ba-ifsc"
                  value={form.ifsc}
                  onChange={(e) => set('ifsc', e.target.value.toUpperCase())}
                  className="font-mono"
                  placeholder="HDFC0000123"
                />
              </Field>
              <Field label="Bank name" htmlFor="ba-bank">
                <Input
                  id="ba-bank"
                  value={form.bankName}
                  onChange={(e) => set('bankName', e.target.value)}
                  placeholder="HDFC Bank"
                />
              </Field>
            </div>
            <Field label="Branch name" htmlFor="ba-branch" optional>
              <Input
                id="ba-branch"
                value={form.branchName}
                onChange={(e) => set('branchName', e.target.value)}
                placeholder="Lower Parel, Mumbai"
              />
            </Field>
            <Field label="UPI ID" htmlFor="ba-upi" optional>
              <Input
                id="ba-upi"
                value={form.upiId}
                onChange={(e) => set('upiId', e.target.value)}
                placeholder="apar@hdfcbank"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                Printed on the invoice with a scannable pay-by-UPI QR code.
              </p>
            </Field>
            <Field label="Notes" htmlFor="ba-notes" optional>
              <Textarea
                id="ba-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
            {!editingId ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={form.isPrimary}
                  onChange={(e) => set('isPrimary', e.target.checked)}
                />
                Make this the primary account
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {editingId ? 'Save changes' : 'Add account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account from the billing list. Past invoices that already reference
              it are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {optional ? <span className="text-muted-foreground"> (optional)</span> : null}
      </Label>
      {children}
    </div>
  );
}
