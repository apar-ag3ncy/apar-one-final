'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

import type { BankAccountRow, BankAccountTypeDb } from '@/lib/server/entities/bank-accounts';

const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{ value: BankAccountTypeDb; label: string }> = [
  { value: 'current', label: 'Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'od', label: 'Overdraft (OD)' },
  { value: 'escrow', label: 'Escrow' },
];

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_RE = /^[0-9]{4,20}$/;

// `accountNumber` is optional here so the SAME schema serves both modes — on
// create we enforce it manually (it can't be pre-filled on edit because the
// full number lives only in the vault).
const formSchema = z.object({
  holderName: z.string().min(1, 'Account-holder name is required').max(200),
  accountNumber: z.string().optional(),
  ifsc: z
    .string()
    .min(1, 'IFSC is required')
    .regex(IFSC_RE, 'Use a valid IFSC, e.g. HDFC0001234.'),
  bankName: z.string().min(1, 'Bank name is required').max(120),
  branch: z.string().max(120).optional(),
  accountType: z.enum(['current', 'savings', 'od', 'escrow']),
  isPrimary: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export type BankAccountFormValues = z.infer<typeof formSchema>;

export type BankAccountFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: Pick<
    BankAccountRow,
    'holderName' | 'ifsc' | 'bankName' | 'branch' | 'accountType' | 'isPrimary' | 'notes'
  >;
  /** Called with form values when the user submits. Caller wires the server action. */
  onSubmit: (values: BankAccountFormValues) => Promise<void>;
  entityName?: string;
};

export function BankAccountForm({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  entityName,
}: BankAccountFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<BankAccountFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      holderName: '',
      accountNumber: '',
      ifsc: '',
      bankName: '',
      branch: '',
      accountType: 'current',
      isPrimary: false,
      notes: '',
    },
  });

  // Reset when switching rows / reopening. The account number is never
  // pre-filled (it lives in the vault) — edit is metadata-only.
  useEffect(() => {
    if (open) {
      form.reset({
        holderName: initial?.holderName ?? '',
        accountNumber: '',
        ifsc: initial?.ifsc ?? '',
        bankName: initial?.bankName ?? '',
        branch: initial?.branch ?? '',
        accountType: initial?.accountType ?? 'current',
        isPrimary: initial?.isPrimary ?? false,
        notes: initial?.notes ?? '',
      });
    }
  }, [open, initial, form]);

  const submit = form.handleSubmit(async (values) => {
    if (mode === 'create' && !ACCOUNT_NUMBER_RE.test((values.accountNumber ?? '').trim())) {
      form.setError('accountNumber', {
        message: 'Enter the full account number (4–20 digits).',
      });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save bank account.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  });

  const title =
    mode === 'create'
      ? entityName
        ? `Add bank account for ${entityName}`
        : 'Add bank account'
      : 'Edit bank account';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            The full account number is stored in the encrypted vault — only the last 4 digits are
            shown afterwards, and revealing the full number is audit-logged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bank-holder">Account holder</Label>
            <Input
              id="bank-holder"
              autoFocus
              placeholder="As printed on the cheque"
              {...form.register('holderName')}
              aria-invalid={form.formState.errors.holderName ? true : undefined}
            />
            {form.formState.errors.holderName ? (
              <p className="text-destructive text-xs">{form.formState.errors.holderName.message}</p>
            ) : null}
          </div>

          {mode === 'create' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="bank-number">Account number</Label>
              <Input
                id="bank-number"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Full account number"
                className="font-mono"
                {...(() => {
                  const r = form.register('accountNumber');
                  return {
                    ...r,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      e.target.value = e.target.value.replace(/\D/g, '');
                      return r.onChange(e);
                    },
                  };
                })()}
                aria-invalid={form.formState.errors.accountNumber ? true : undefined}
              />
              {form.formState.errors.accountNumber ? (
                <p className="text-destructive text-xs">
                  {form.formState.errors.accountNumber.message}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              To change the account number, remove this account and add it again.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bank-name">Bank name</Label>
              <Input
                id="bank-name"
                placeholder="HDFC Bank"
                {...form.register('bankName')}
                aria-invalid={form.formState.errors.bankName ? true : undefined}
              />
              {form.formState.errors.bankName ? (
                <p className="text-destructive text-xs">{form.formState.errors.bankName.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bank-ifsc">IFSC</Label>
              <Input
                id="bank-ifsc"
                placeholder="HDFC0001234"
                maxLength={11}
                className="font-mono uppercase"
                {...(() => {
                  const r = form.register('ifsc');
                  return {
                    ...r,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      e.target.value = e.target.value.toUpperCase();
                      return r.onChange(e);
                    },
                  };
                })()}
                aria-invalid={form.formState.errors.ifsc ? true : undefined}
              />
              {form.formState.errors.ifsc ? (
                <p className="text-destructive text-xs">{form.formState.errors.ifsc.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bank-branch">Branch</Label>
              <Input
                id="bank-branch"
                placeholder="Lower Parel, Mumbai (optional)"
                {...form.register('branch')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bank-type">Account type</Label>
              <Select
                value={form.watch('accountType')}
                onValueChange={(v) => form.setValue('accountType', v as BankAccountTypeDb)}
              >
                <SelectTrigger id="bank-type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bank-primary"
              checked={form.watch('isPrimary')}
              onCheckedChange={(v) => form.setValue('isPrimary', v === true)}
            />
            <Label htmlFor="bank-primary" className="cursor-pointer text-sm font-normal">
              Mark as primary account
            </Label>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bank-notes">Notes</Label>
            <Textarea
              id="bank-notes"
              rows={2}
              placeholder="Anything the team should know."
              {...form.register('notes')}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Add bank account' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
