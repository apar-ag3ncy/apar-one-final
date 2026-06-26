'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PlusIcon, PencilIcon, StarIcon, Trash2Icon } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  createInvoiceTheme,
  updateInvoiceTheme,
  setDefaultTheme,
  deleteInvoiceTheme,
  listInvoiceThemes,
  type InvoiceThemeSummary,
} from '@/lib/server/billing/invoice-themes';
import { INVOICE_FONTS } from '@/lib/billing/invoice-fonts';

type Form = {
  name: string;
  headerText: string;
  footerText: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  makeDefault: boolean;
};

const EMPTY: Form = {
  name: '',
  headerText: 'TAX INVOICE',
  footerText: '',
  primaryColor: '#111111',
  accentColor: '#F3F4F6',
  fontFamily: 'Helvetica',
  makeDefault: false,
};

/**
 * Dynamic invoice-format editor. Lists the invoice formats (themes), lets the
 * user create a custom one or edit a non-builtin one — name, the header
 * banner ("TAX INVOICE"), footer text, brand colours and font — and pick the
 * default that new invoices use. Built-in formats are read-only.
 */
export function InvoiceFormatEditor() {
  const [themes, setThemes] = useState<InvoiceThemeSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    listInvoiceThemes()
      .then(setThemes)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : 'Could not load invoice formats.'),
      );
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(t: InvoiceThemeSummary) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      headerText: t.headerText ?? 'TAX INVOICE',
      footerText: t.footerText ?? '',
      primaryColor: t.primaryColor ?? '#111111',
      accentColor: t.accentColor ?? '#F3F4F6',
      fontFamily: t.fontFamily ?? 'Helvetica',
      makeDefault: t.isDefault,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Give the format a name.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        headerText: form.headerText.trim() || null,
        footerText: form.footerText.trim() || null,
        primaryColor: form.primaryColor || null,
        accentColor: form.accentColor || null,
        fontFamily: form.fontFamily || null,
        makeDefault: form.makeDefault,
      };
      if (editingId) await updateInvoiceTheme(editingId, payload);
      else await createInvoiceTheme(payload);
      toast.success(editingId ? 'Invoice format updated.' : 'Invoice format created.');
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the format.');
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(id: string) {
    try {
      await setDefaultTheme(id);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set the default.');
    }
  }
  async function remove(t: InvoiceThemeSummary) {
    if (!confirm(`Delete the "${t.name}" invoice format?`)) return;
    try {
      await deleteInvoiceTheme(t.id);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the format.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Invoice format</h3>
          <p className="text-muted-foreground text-xs">
            Customise the invoice PDF — header title, footer, brand colour and font. The default
            format is used for new invoices.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1.5 size-4" aria-hidden />
          New format
        </Button>
      </div>

      <div className="divide-y rounded-md border">
        {themes === null ? (
          <p className="text-muted-foreground p-3 text-sm">Loading…</p>
        ) : themes.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            No formats yet. Create one to control how invoices look.
          </p>
        ) : (
          themes.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3">
              <span
                className="size-5 shrink-0 rounded-sm border"
                style={{ background: t.primaryColor ?? '#111111' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {t.isDefault ? <StatusBadge tone="success" label="Default" /> : null}
                  {!t.editable ? (
                    <StatusBadge tone="neutral" label="Built-in" />
                  ) : t.imported ? (
                    <StatusBadge tone="info" label="Imported" />
                  ) : (
                    <StatusBadge tone="neutral" label="Custom" />
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {t.headerText ?? 'TAX INVOICE'} · {t.fontFamily ?? 'Helvetica'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!t.isDefault ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void makeDefault(t.id)}
                    title="Set as default"
                  >
                    <StarIcon className="size-4" aria-hidden />
                  </Button>
                ) : null}
                {t.editable ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="Edit">
                      <PencilIcon className="size-4" aria-hidden />
                    </Button>
                    {!t.isDefault ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void remove(t)}
                        title="Delete"
                      >
                        <Trash2Icon className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit invoice format' : 'New invoice format'}</DialogTitle>
            <DialogDescription>
              These tokens overlay the GST invoice template — the layout and tax columns stay
              compliant.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fmt-name">Format name</Label>
              <Input
                id="fmt-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Apar — Default"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="fmt-header">Header title</Label>
                <Input
                  id="fmt-header"
                  value={form.headerText}
                  onChange={(e) => set('headerText', e.target.value)}
                  placeholder="TAX INVOICE"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fmt-font">Font</Label>
                <Select value={form.fontFamily} onValueChange={(v) => set('fontFamily', v)}>
                  <SelectTrigger id="fmt-font">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_FONTS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="fmt-primary">Brand colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="fmt-primary"
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => set('primaryColor', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border"
                  />
                  <Input
                    value={form.primaryColor}
                    onChange={(e) => set('primaryColor', e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fmt-accent">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="fmt-accent"
                    type="color"
                    value={form.accentColor}
                    onChange={(e) => set('accentColor', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border"
                  />
                  <Input
                    value={form.accentColor}
                    onChange={(e) => set('accentColor', e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fmt-footer">Footer text</Label>
              <Textarea
                id="fmt-footer"
                rows={2}
                value={form.footerText}
                onChange={(e) => set('footerText', e.target.value)}
                placeholder="Computer-generated; no signature required."
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.makeDefault}
                onChange={(e) => set('makeDefault', e.target.checked)}
              />
              Use this format by default for new invoices
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save format' : 'Create format'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
