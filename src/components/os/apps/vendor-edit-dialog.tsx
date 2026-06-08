'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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
import { updateVendor, type UpdateVendorInput } from '@/lib/server/entities/vendors';
import type { Vendor, VendorCategory } from '@/components/vendors/types';

const CATEGORIES: readonly VendorCategory[] = [
  'photographer',
  'videographer',
  'printer',
  'software',
  'agency',
  'logistics',
  'other',
];

function catLabel(c: VendorCategory): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

const formSchema = z.object({
  name: z.string().min(1, 'Vendor name is required').max(200),
  category: z.enum([
    'photographer',
    'videographer',
    'printer',
    'software',
    'agency',
    'logistics',
    'other',
  ]),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof formSchema>;

function toDefaults(v: Vendor): FormValues {
  return {
    name: v.name,
    category: v.category,
    gstin: v.gstin ?? '',
    pan: v.pan ?? '',
    notes: v.notes ?? '',
  };
}

/**
 * OS "Edit vendor" dialog. Renders its own trigger button for the
 * VendorWindow header. Persists via the `updateVendor` server action and
 * calls `onSaved` so the window refetches. Only changed fields are sent.
 */
export function VendorEditDialog({ vendor, onSaved }: { vendor: Vendor; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toDefaults(vendor),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(vendor));
  }, [open, vendor, form]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const patch: UpdateVendorInput = { id: vendor.id };
      if (values.name !== vendor.name) patch.name = values.name;
      if (values.category !== vendor.category) patch.category = values.category;
      if ((values.gstin ?? '') !== (vendor.gstin ?? ''))
        patch.gstin = values.gstin ? values.gstin : null;
      if ((values.pan ?? '') !== (vendor.pan ?? '')) patch.pan = values.pan ? values.pan : null;
      if ((values.notes ?? '') !== (vendor.notes ?? ''))
        patch.notes = values.notes ? values.notes : null;

      if (Object.keys(patch).length === 1) {
        setOpen(false);
        return;
      }

      const result = await updateVendor(patch);
      if (!result.ok) {
        let attached = false;
        for (const key of ['name', 'gstin', 'pan'] as const) {
          if (result.errors[key]) {
            form.setError(key, { type: 'server', message: result.errors[key] });
            attached = true;
          }
        }
        if (!attached) toast.error(result.message);
        return;
      }
      toast.success(`Updated ${values.name}.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the vendor.');
    } finally {
      setSubmitting(false);
    }
  });

  const category = form.watch('category');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {vendor.name}</DialogTitle>
          <DialogDescription>
            Update the core profile. Contacts, banking, and documents are edited from their tabs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="vendor-name">Vendor name</Label>
            <Input
              id="vendor-name"
              autoFocus
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vendor-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => form.setValue('category', v as VendorCategory)}
            >
              <SelectTrigger id="vendor-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {catLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="vendor-gstin">GSTIN</Label>
              <Input id="vendor-gstin" placeholder="27ABCDE1234F1Z5" {...form.register('gstin')} />
              {form.formState.errors.gstin ? (
                <p className="text-destructive text-xs">{form.formState.errors.gstin.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vendor-pan">PAN</Label>
              <Input id="vendor-pan" placeholder="ABCDE1234F" {...form.register('pan')} />
              {form.formState.errors.pan ? (
                <p className="text-destructive text-xs">{form.formState.errors.pan.message}</p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vendor-notes">Notes</Label>
            <Textarea id="vendor-notes" rows={3} {...form.register('notes')} />
          </div>
          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
