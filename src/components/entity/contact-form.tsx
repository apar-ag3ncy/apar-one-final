'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

import type { ContactRow } from '@/lib/server/entities/contacts';

const formSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(120),
    role: z.string().max(120).optional(),
    email: z.union([z.literal(''), z.string().email()]).optional(),
    phone: z.string().max(40).optional(),
    isPrimary: z.boolean(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => (v.email ?? '').length > 0 || (v.phone ?? '').length > 0, {
    message: 'Provide at least one of email or phone.',
    path: ['email'],
  });

export type ContactFormValues = z.infer<typeof formSchema>;

export type ContactFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initial?: Pick<ContactRow, 'name' | 'role' | 'email' | 'phone' | 'isPrimary' | 'notes'>;
  /** Called with form values when the user submits. Caller wires the server action. */
  onSubmit: (values: ContactFormValues) => Promise<void>;
  entityName?: string;
};

export function ContactForm({
  open,
  onOpenChange,
  mode,
  initial,
  onSubmit,
  entityName,
}: ContactFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      role: '',
      email: '',
      phone: '',
      isPrimary: false,
      notes: '',
    },
  });

  // Reset form only when the dialog opens (switching between rows). `initial`
  // is a fresh object literal on every parent render, so keying the effect on
  // it would wipe the user's in-progress typing whenever anything above
  // re-renders (in the OS: the menubar clock, window focus/drag, …).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      form.reset({
        name: initial?.name ?? '',
        role: initial?.role ?? '',
        email: initial?.email ?? '',
        phone: initial?.phone ?? '',
        isPrimary: initial?.isPrimary ?? false,
        notes: initial?.notes ?? '',
      });
    }
    wasOpen.current = open;
  }, [open, initial, form]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save contact.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  });

  const title =
    mode === 'create'
      ? entityName
        ? `Add contact for ${entityName}`
        : 'Add contact'
      : 'Edit contact';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>At least one of email or phone is required.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              autoFocus
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contact-role">Title / role</Label>
            <Input id="contact-role" placeholder="Founder, CFO, etc." {...form.register('role')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                placeholder="anjali@example.com"
                {...form.register('email')}
                aria-invalid={form.formState.errors.email ? true : undefined}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                inputMode="tel"
                placeholder="+91 98200 11111"
                {...form.register('phone')}
                aria-invalid={form.formState.errors.phone ? true : undefined}
              />
            </div>
          </div>
          {form.formState.errors.email ? (
            <p className="text-destructive text-xs">{form.formState.errors.email.message}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="contact-primary"
              checked={form.watch('isPrimary')}
              onCheckedChange={(v) => form.setValue('isPrimary', v === true)}
            />
            <Label htmlFor="contact-primary" className="cursor-pointer text-sm font-normal">
              Mark as primary contact
            </Label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contact-notes">Notes</Label>
            <Textarea
              id="contact-notes"
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
              {submitting ? 'Saving…' : mode === 'create' ? 'Add contact' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
