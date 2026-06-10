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

import type { AddressKindDb, AddressRow } from '@/lib/server/entities/addresses';

const KIND_OPTIONS: ReadonlyArray<{ value: AddressKindDb; label: string }> = [
  { value: 'billing', label: 'Billing' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'registered', label: 'Registered' },
  { value: 'site', label: 'Site' },
  { value: 'home', label: 'Home' },
];

const kindSchema = z.enum(['billing', 'shipping', 'registered', 'site', 'home']);

const formSchema = z.object({
  kind: kindSchema,
  line1: z.string().min(1, 'Address line 1 is required').max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1, 'City is required').max(120),
  stateCode: z
    .string()
    .min(1, 'State code is required')
    .regex(/^[A-Z]{2}$/, 'Use a 2-letter uppercase code, e.g. MH, KA, DL.'),
  postalCode: z.string().max(20).optional(),
  country: z
    .string()
    .min(2)
    .max(2)
    .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, e.g. IN.'),
  gstin: z.string().max(20).optional(),
  isPrimary: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export type AddressFormValues = z.infer<typeof formSchema>;

export type AddressFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: Pick<
    AddressRow,
    | 'kind'
    | 'line1'
    | 'line2'
    | 'city'
    | 'stateCode'
    | 'postalCode'
    | 'country'
    | 'gstin'
    | 'isPrimary'
    | 'notes'
  >;
  /** Called with form values when the user submits. Caller wires the server action. */
  onSubmit: (values: AddressFormValues) => Promise<void>;
  entityName?: string;
};

export function AddressForm({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  entityName,
}: AddressFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<AddressFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      kind: 'billing',
      line1: '',
      line2: '',
      city: '',
      stateCode: '',
      postalCode: '',
      country: 'IN',
      gstin: '',
      isPrimary: false,
      notes: '',
    },
  });

  // Reset form when initial values change (switching between rows).
  useEffect(() => {
    if (open) {
      form.reset({
        kind: initial?.kind ?? 'billing',
        line1: initial?.line1 ?? '',
        line2: initial?.line2 ?? '',
        city: initial?.city ?? '',
        stateCode: initial?.stateCode ?? '',
        postalCode: initial?.postalCode ?? '',
        country: initial?.country ?? 'IN',
        gstin: initial?.gstin ?? '',
        isPrimary: initial?.isPrimary ?? false,
        notes: initial?.notes ?? '',
      });
    }
  }, [open, initial, form]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save address.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  });

  const title =
    mode === 'create'
      ? entityName
        ? `Add address for ${entityName}`
        : 'Add address'
      : 'Edit address';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            State code must be a 2-letter uppercase code (e.g. MH).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="address-kind">Kind</Label>
            <Select
              value={form.watch('kind')}
              onValueChange={(v) => form.setValue('kind', v as AddressKindDb)}
            >
              <SelectTrigger id="address-kind">
                <SelectValue placeholder="Select a kind" />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="address-line1">Address line 1</Label>
            <Input
              id="address-line1"
              autoFocus
              {...form.register('line1')}
              aria-invalid={form.formState.errors.line1 ? true : undefined}
            />
            {form.formState.errors.line1 ? (
              <p className="text-destructive text-xs">{form.formState.errors.line1.message}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="address-line2">Address line 2</Label>
            <Input
              id="address-line2"
              placeholder="Suite, floor, landmark (optional)"
              {...form.register('line2')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="address-city">City</Label>
              <Input
                id="address-city"
                {...form.register('city')}
                aria-invalid={form.formState.errors.city ? true : undefined}
              />
              {form.formState.errors.city ? (
                <p className="text-destructive text-xs">{form.formState.errors.city.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="address-state">State code</Label>
              <Input
                id="address-state"
                placeholder="MH"
                maxLength={2}
                className="uppercase"
                {...(() => {
                  const r = form.register('stateCode');
                  return {
                    ...r,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      e.target.value = e.target.value.toUpperCase();
                      return r.onChange(e);
                    },
                  };
                })()}
                aria-invalid={form.formState.errors.stateCode ? true : undefined}
              />
              {form.formState.errors.stateCode ? (
                <p className="text-destructive text-xs">
                  {form.formState.errors.stateCode.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="address-postal">Postal code</Label>
              <Input
                id="address-postal"
                inputMode="numeric"
                placeholder="400001"
                {...form.register('postalCode')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="address-country">Country</Label>
              <Input
                id="address-country"
                placeholder="IN"
                maxLength={2}
                className="uppercase"
                {...(() => {
                  const r = form.register('country');
                  return {
                    ...r,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      e.target.value = e.target.value.toUpperCase();
                      return r.onChange(e);
                    },
                  };
                })()}
                aria-invalid={form.formState.errors.country ? true : undefined}
              />
              {form.formState.errors.country ? (
                <p className="text-destructive text-xs">{form.formState.errors.country.message}</p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="address-gstin">GSTIN</Label>
            <Input
              id="address-gstin"
              placeholder="27AAAAA0000A1Z5 (optional)"
              className="font-mono"
              {...form.register('gstin')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="address-primary"
              checked={form.watch('isPrimary')}
              onCheckedChange={(v) => form.setValue('isPrimary', v === true)}
            />
            <Label htmlFor="address-primary" className="cursor-pointer text-sm font-normal">
              Mark as primary address
            </Label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="address-notes">Notes</Label>
            <Textarea
              id="address-notes"
              rows={3}
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
              {submitting ? 'Saving…' : mode === 'create' ? 'Add address' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
