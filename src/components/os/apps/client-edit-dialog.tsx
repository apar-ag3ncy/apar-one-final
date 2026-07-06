'use client';

import { useEffect, useRef, useState } from 'react';
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
import { listAddresses } from '@/lib/server/entities/addresses';
import { updateClient, type UpdateClientInput } from '@/lib/server/entities/clients';
import { uploadDocument } from '@/lib/server/entities/entity-documents';
import { resolveDocumentUrl } from '@/lib/server-stub/entity-actions';
import type { Client, ClientStatus } from '@/components/clients/types';

// UI status → DB client_status. 'archived' is a lifecycle state (Settings),
// not a status the editor sets, so it maps to the closest editable value.
type EditableStatus = 'active' | 'onboarding' | 'inactive';
const UI_TO_DB_STATUS: Record<EditableStatus, UpdateClientInput['status']> = {
  active: 'active',
  onboarding: 'prospect',
  inactive: 'inactive',
};
const STATUS_LABELS: Record<EditableStatus, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  inactive: 'Inactive',
};
const STATUS_OPTIONS: readonly EditableStatus[] = ['active', 'onboarding', 'inactive'];

function toEditableStatus(s: ClientStatus): EditableStatus {
  return s === 'active' || s === 'onboarding' || s === 'inactive' ? s : 'inactive';
}

const formSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(200),
  industry: z.string().max(160).optional(),
  status: z.enum(['active', 'onboarding', 'inactive']),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  address: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof formSchema>;

function toDefaults(c: Client, address = ''): FormValues {
  return {
    name: c.name,
    industry: c.industry ?? '',
    status: toEditableStatus(c.status),
    gstin: c.gstin ?? '',
    pan: c.pan ?? '',
    address,
    notes: c.notes ?? '',
  };
}

/**
 * OS "Edit client" dialog. Renders its own trigger button so it drops into
 * the ClientWindow header. Persists via the `updateClient` server action and
 * calls `onSaved` so the window refetches. Only changed fields are sent.
 */
export function ClientEditDialog({ client, onSaved }: { client: Client; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The registered address lives in `entity_addresses` (not on the `clients`
  // row), so it's loaded lazily when the dialog opens. We keep the loaded value
  // to diff against on save, so an in-flight load can never wipe the address.
  const [initialAddress, setInitialAddress] = useState('');
  // Logo: current one resolves to a short-lived signed URL for preview; a
  // newly picked file previews via an object URL and uploads on save.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toDefaults(client),
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(false);
    setCurrentLogoUrl(null);
    if (client.logoDocumentId) {
      resolveDocumentUrl(client.logoDocumentId)
        .then((r) => {
          if (active) setCurrentLogoUrl(r.url);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [open, client]);

  useEffect(() => {
    if (!open) return;
    form.reset(toDefaults(client));
    setInitialAddress('');
    let active = true;
    listAddresses({ entityType: 'client', entityId: client.id })
      .then((rows) => {
        // Don't clobber text the user already started typing while the load was
        // in flight — only seed the field if it's still pristine.
        if (!active || form.getFieldState('address').isDirty) return;
        const registered =
          rows.find((r) => r.kind === 'registered') ??
          rows.find((r) => r.isPrimary) ??
          rows[0] ??
          null;
        const line = registered?.line1 ?? '';
        setInitialAddress(line);
        form.setValue('address', line);
      })
      .catch(() => {
        /* address is optional — a load failure just leaves the field empty */
      });
    return () => {
      active = false;
    };
  }, [open, client, form]);

  const submit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const patch: UpdateClientInput = { id: client.id };
      if (values.name !== client.name) patch.name = values.name;
      if ((values.industry ?? '') !== (client.industry ?? '')) {
        patch.industry = values.industry ? values.industry : null;
      }
      if (values.status !== toEditableStatus(client.status)) {
        patch.status = UI_TO_DB_STATUS[values.status];
      }
      if ((values.gstin ?? '') !== (client.gstin ?? ''))
        patch.gstin = values.gstin ? values.gstin : null;
      if ((values.pan ?? '') !== (client.pan ?? '')) patch.pan = values.pan ? values.pan : null;
      // Only send a real, non-empty address change. Removing an address isn't
      // supported here (the server treats empty as a no-op to guard against an
      // in-flight load wiping data) — use the Addresses editor for that — so we
      // never send a null that would report a phantom "saved".
      const nextAddress = (values.address ?? '').trim();
      if (nextAddress.length > 0 && nextAddress !== initialAddress.trim()) {
        patch.registeredAddress = nextAddress;
      }
      if ((values.notes ?? '') !== (client.notes ?? ''))
        patch.notes = values.notes ? values.notes : null;

      // Logo: upload the newly picked image first (standard entity-documents
      // pipeline, kind 'photo'), then point the client row at it. An explicit
      // "remove" clears the pointer — the avatar falls back to initials.
      if (logoFile) {
        const fd = new FormData();
        fd.append('file', logoFile);
        fd.append('entityType', 'client');
        fd.append('entityId', client.id);
        fd.append('kind', 'photo');
        fd.append('title', 'Client logo');
        const { documentId } = await uploadDocument(fd);
        patch.logoDocumentId = documentId;
      } else if (removeLogo && client.logoDocumentId) {
        patch.logoDocumentId = null;
      }

      if (Object.keys(patch).length === 1) {
        setOpen(false);
        return;
      }

      const result = await updateClient(patch);
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
      toast.error(err instanceof Error ? err.message : 'Could not update the client.');
    } finally {
      setSubmitting(false);
    }
  });

  const status = form.watch('status');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {client.name}</DialogTitle>
          <DialogDescription>
            Update the core profile. Contacts, banking, and documents are edited from their tabs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Logo</Label>
            <div className="flex items-center gap-3">
              {logoPreview || (!removeLogo && currentLogoUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview ?? currentLogoUrl ?? undefined}
                  alt={`${client.name} logo`}
                  className="size-12 rounded-md border object-cover"
                />
              ) : (
                <div className="text-muted-foreground flex size-12 items-center justify-center rounded-md border text-xs">
                  {client.name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase() ?? '')
                    .join('')}
                </div>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) {
                    toast.error('Logo must be under 5 MB.');
                    return;
                  }
                  setLogoFile(f);
                  setRemoveLogo(false);
                  setLogoPreview((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return URL.createObjectURL(f);
                  });
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => logoInputRef.current?.click()}
                disabled={submitting}
              >
                {client.logoDocumentId || logoFile ? 'Change logo' : 'Upload logo'}
              </Button>
              {(client.logoDocumentId && !removeLogo) || logoFile ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => {
                    setLogoFile(null);
                    setLogoPreview((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return null;
                    });
                    setRemoveLogo(true);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Shown instead of the initials everywhere this client appears.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-name">Client name</Label>
            <Input
              id="client-name"
              autoFocus
              {...form.register('name')}
              aria-invalid={form.formState.errors.name ? true : undefined}
            />
            {form.formState.errors.name ? (
              <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="client-industry">Industry</Label>
              <Input
                id="client-industry"
                placeholder="Real Estate"
                {...form.register('industry')}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-status">Status</Label>
              <Select
                value={status}
                onValueChange={(v) => form.setValue('status', v as EditableStatus)}
              >
                <SelectTrigger id="client-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="client-gstin">GSTIN</Label>
              <Input id="client-gstin" placeholder="27ABCDE1234F1Z5" {...form.register('gstin')} />
              {form.formState.errors.gstin ? (
                <p className="text-destructive text-xs">{form.formState.errors.gstin.message}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-pan">PAN</Label>
              <Input id="client-pan" placeholder="ABCDE1234F" {...form.register('pan')} />
              {form.formState.errors.pan ? (
                <p className="text-destructive text-xs">{form.formState.errors.pan.message}</p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-address">Registered address</Label>
            <Textarea
              id="client-address"
              rows={2}
              placeholder="Registered office address (used on GST invoices)"
              {...form.register('address')}
            />
            <p className="text-muted-foreground text-xs">
              GSTIN, PAN &amp; a registered address are required before invoices can be generated
              for this client.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-notes">Notes</Label>
            <Textarea id="client-notes" rows={3} {...form.register('notes')} />
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
