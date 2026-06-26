'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImageIcon, PlusIcon, PencilIcon, StarIcon, Trash2Icon } from 'lucide-react';

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
  uploadThemeLogo,
  removeThemeLogo,
  type InvoiceThemeSummary,
} from '@/lib/server/billing/invoice-themes';
import { INVOICE_FONTS } from '@/lib/billing/invoice-fonts';
import { InvoiceLayoutEditor } from '@/components/settings/invoice-layout-editor';
import { getCompanyPreview, type CompanyPreview } from '@/lib/server/settings/company';
import type { InvoiceColumns, InvoiceColors } from '@/lib/billing/invoice-style';
import { DEFAULT_INVOICE_LAYOUT, type InvoiceLayout } from '@/lib/billing/invoice-layout';
import { DEFAULT_INVOICE_STYLE, type InvoiceStyle } from '@/lib/billing/invoice-style';

type Form = {
  name: string;
  headerText: string;
  footerText: string;
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  makeDefault: boolean;
  layout: InvoiceLayout;
  style: InvoiceStyle;
};

const EMPTY: Form = {
  name: '',
  headerText: 'TAX INVOICE',
  footerText: '',
  primaryColor: '#111111',
  accentColor: '#F3F4F6',
  fontFamily: 'Helvetica',
  makeDefault: false,
  layout: DEFAULT_INVOICE_LAYOUT,
  style: DEFAULT_INVOICE_STYLE,
};

const FONT_SIZE_OPTIONS = [
  { label: 'Small', value: 0.9 },
  { label: 'Normal', value: 1 },
  { label: 'Large', value: 1.15 },
  { label: 'Extra large', value: 1.25 },
] as const;

/** An optional colour swatch with an "Auto" (derive from brand/accent) state. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const isSet = value != null;
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value ?? '#3366CC'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Use the automatic colour"
          className={`rounded border px-1.5 py-0.5 text-[11px] ${isSet ? 'text-muted-foreground' : 'bg-muted text-foreground'}`}
        >
          Auto
        </button>
      </div>
    </div>
  );
}

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
  const [editingTheme, setEditingTheme] = useState<InvoiceThemeSummary | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  // Real company header details for the preview (editable, preview-only).
  const [company, setCompany] = useState<CompanyPreview>({
    name: '',
    address: '',
    gstin: null,
    pan: null,
  });

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
  useEffect(() => {
    getCompanyPreview()
      .then((c) => {
        if (c) setCompany(c);
      })
      .catch(() => {
        /* preview falls back to a sample name */
      });
  }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setStyle<K extends keyof InvoiceStyle>(key: K, value: InvoiceStyle[K]) {
    setForm((f) => ({ ...f, style: { ...f.style, [key]: value } }));
  }
  function setColumn<K extends keyof InvoiceColumns>(key: K, value: InvoiceColumns[K]) {
    setForm((f) => ({
      ...f,
      style: { ...f.style, columns: { ...f.style.columns, [key]: value } },
    }));
  }
  function setColor<K extends keyof InvoiceColors>(key: K, value: InvoiceColors[K]) {
    setForm((f) => ({ ...f, style: { ...f.style, colors: { ...f.style.colors, [key]: value } } }));
  }

  function openCreate() {
    setEditingId(null);
    setEditingTheme(null);
    setForm(EMPTY);
    setOpen(true);
  }
  function openEdit(t: InvoiceThemeSummary) {
    setEditingId(t.id);
    setEditingTheme(t);
    setForm({
      name: t.name,
      headerText: t.headerText ?? 'TAX INVOICE',
      footerText: t.footerText ?? '',
      primaryColor: t.primaryColor ?? '#111111',
      accentColor: t.accentColor ?? '#F3F4F6',
      fontFamily: t.fontFamily ?? 'Helvetica',
      makeDefault: t.isDefault,
      layout: t.layout,
      style: t.style,
    });
    setOpen(true);
  }

  async function onLogoFile(file: File | null) {
    if (!file || !editingId) return;
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('themeId', editingId);
      fd.append('file', file);
      const updated = await uploadThemeLogo(fd);
      setEditingTheme(updated);
      toast.success('Logo uploaded.');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the logo.');
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function onRemoveLogo() {
    if (!editingId) return;
    setLogoBusy(true);
    try {
      const updated = await removeThemeLogo(editingId);
      setEditingTheme(updated);
      toast.success('Logo removed.');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
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
        layout: form.layout,
        style: form.style,
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
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit invoice format' : 'New invoice format'}</DialogTitle>
            <DialogDescription>
              Brand tokens overlay the GST invoice template; drag blocks to arrange the page. The
              line-items &amp; tax table stay fixed and compliant.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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

            {/* Style — size, density, logo footprint and a few polish toggles. */}
            <div className="grid gap-2">
              <Label>Style</Label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="fmt-fontsize"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Font size
                  </Label>
                  <Select
                    value={String(form.style.fontScale)}
                    onValueChange={(v) => setStyle('fontScale', Number(v))}
                  >
                    <SelectTrigger id="fmt-fontsize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_SIZE_OPTIONS.map((o) => (
                        <SelectItem key={o.label} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="fmt-density"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Density
                  </Label>
                  <Select
                    value={form.style.density}
                    onValueChange={(v) => setStyle('density', v as InvoiceStyle['density'])}
                  >
                    <SelectTrigger id="fmt-density">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compact">Compact</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="relaxed">Relaxed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="fmt-logosize"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Logo size
                  </Label>
                  <Select
                    value={form.style.logoSize}
                    onValueChange={(v) => setStyle('logoSize', v as InvoiceStyle['logoSize'])}
                  >
                    <SelectTrigger id="fmt-logosize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sm">Small</SelectItem>
                      <SelectItem value="md">Medium</SelectItem>
                      <SelectItem value="lg">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="fmt-logoalign"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Logo align
                  </Label>
                  <Select
                    value={form.style.logoAlign}
                    onValueChange={(v) => setStyle('logoAlign', v as InvoiceStyle['logoAlign'])}
                  >
                    <SelectTrigger id="fmt-logoalign">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.accentHeaderBand}
                    onChange={(e) => setStyle('accentHeaderBand', e.target.checked)}
                  />
                  Accent title band
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.emphasizeTotal}
                    onChange={(e) => setStyle('emphasizeTotal', e.target.checked)}
                  />
                  Emphasise grand total
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.colorHeadings}
                    onChange={(e) => setStyle('colorHeadings', e.target.checked)}
                  />
                  Colour section headings
                </label>
              </div>
            </div>

            {/* Table columns */}
            <div className="grid gap-2">
              <Label>Table columns</Label>
              <p className="text-muted-foreground text-xs">
                Choose which line-item columns appear. Description and Amount always show.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.columns.srNo}
                    onChange={(e) => setColumn('srNo', e.target.checked)}
                  />
                  Sr. No.
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.columns.hsn}
                    onChange={(e) => setColumn('hsn', e.target.checked)}
                  />
                  HSN/SAC
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.columns.qtyRate}
                    onChange={(e) => setColumn('qtyRate', e.target.checked)}
                  />
                  Quantity &amp; Rate
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.style.columns.taxPct}
                    onChange={(e) => setColumn('taxPct', e.target.checked)}
                  />
                  Tax % per line
                </label>
              </div>
            </div>

            {/* Element colours */}
            <div className="grid gap-2">
              <Label>Element colours</Label>
              <p className="text-muted-foreground text-xs">
                Leave on “Auto” to derive from your brand &amp; accent colours.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ColorField
                  label="Table header"
                  value={form.style.colors.tableHeaderBg}
                  onChange={(v) => setColor('tableHeaderBg', v)}
                />
                <ColorField
                  label="Grand-total row"
                  value={form.style.colors.totalBg}
                  onChange={(v) => setColor('totalBg', v)}
                />
                <ColorField
                  label="Section headings"
                  value={form.style.colors.heading}
                  onChange={(v) => setColor('heading', v)}
                />
                <ColorField
                  label="Document title"
                  value={form.style.colors.title}
                  onChange={(v) => setColor('title', v)}
                />
              </div>
            </div>

            {/* Preview details — editable sample header, preview-only. */}
            <div className="grid gap-2">
              <Label>Preview details</Label>
              <p className="text-muted-foreground text-xs">
                Sample header shown in the preview. Defaults to your real company; your actual
                invoices always use Settings → Company.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="prev-company"
                    className="text-muted-foreground text-xs font-normal"
                  >
                    Company name
                  </Label>
                  <Input
                    id="prev-company"
                    value={company.name}
                    onChange={(e) => setCompany((c) => ({ ...c, name: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="prev-gstin" className="text-muted-foreground text-xs font-normal">
                    GSTIN
                  </Label>
                  <Input
                    id="prev-gstin"
                    value={company.gstin ?? ''}
                    onChange={(e) => setCompany((c) => ({ ...c, gstin: e.target.value || null }))}
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="prev-addr" className="text-muted-foreground text-xs font-normal">
                    Address
                  </Label>
                  <Input
                    id="prev-addr"
                    value={company.address}
                    onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* Logo — uploadable once the format exists (we need its id to attach). */}
            <div className="grid gap-1.5">
              <Label>Logo</Label>
              {editingId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => void onLogoFile(e.target.files?.[0] ?? null)}
                    disabled={logoBusy}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoBusy}
                  >
                    <ImageIcon className="mr-1.5 size-4" aria-hidden />
                    {logoBusy
                      ? 'Uploading…'
                      : editingTheme?.hasLogo
                        ? 'Replace logo'
                        : 'Upload logo'}
                  </Button>
                  {editingTheme?.hasLogo ? (
                    <>
                      <span className="text-muted-foreground text-xs">A logo is set.</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void onRemoveLogo()}
                        disabled={logoBusy}
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      PNG or JPEG. Falls back to the default mark when unset.
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Create the format first, then reopen it to upload a logo.
                </p>
              )}
            </div>

            {/* Drag-and-drop layout board + live preview. */}
            <div className="grid gap-1.5">
              <Label>Layout</Label>
              <InvoiceLayoutEditor
                key={editingId ?? 'new'}
                defaultValue={form.layout}
                onChange={(layout) => set('layout', layout)}
                primaryColor={form.primaryColor}
                accentColor={form.accentColor}
                fontFamily={form.fontFamily}
                headerText={form.headerText}
                style={form.style}
                company={company}
              />
            </div>
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
