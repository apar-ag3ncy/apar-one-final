'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DownloadIcon,
  FileCheck2Icon,
  FilePenIcon,
  FileTextIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { InvoiceComposerDialog } from '@/components/entity/billing/invoice-composer';
import { UploadInvoiceDialog } from '@/components/entity/billing/upload-invoice-dialog';
import { useCurrentUser } from '@/lib/client/use-current-user';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';
import { formatINR } from '@/lib/money';
import {
  deleteDraftInvoice,
  getClientBillingReadiness,
  listInvoices,
  type ClientBillingReadiness,
} from '@/lib/server/billing/invoices';
import { voidInvoice } from '@/lib/server/billing/invoice-transitions';
import {
  amendInvoice,
  getInvoiceAmendmentChain,
  type InvoiceAmendmentChainEntry,
  type InvoiceAmendmentChainLine,
} from '@/lib/server/billing/invoice-amendment';
import { convertProformaToInvoice } from '@/lib/server/billing/proforma-conversion';
import {
  listUnrecordedClientInvoiceDocuments,
  type UnrecordedInvoiceDocument,
} from '@/lib/server/billing/record-uploaded-invoice';
import {
  deleteInvoiceTheme,
  listInvoiceThemes,
  setDefaultTheme,
  uploadDocxTheme,
  type InvoiceThemeSummary,
} from '@/lib/server/billing/invoice-themes';
import {
  listCompanyBankAccountOptions,
  type CompanyBankAccountOption,
} from '@/lib/server/settings/company';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';

type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>['rows'][number];

const STATE_TONE: Record<InvoiceRow['state'], StatusTone> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
};

const STATE_LABEL: Record<InvoiceRow['state'], string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Deleted',
};

/* -------------------------------------------------------------------------- */
/* Filter + sort helpers for the invoice list                                 */
/* -------------------------------------------------------------------------- */

type DatePreset = 'all' | 'week' | 'month' | 'last-month' | 'quarter' | 'fy' | 'custom';

const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  all: 'Any date',
  week: 'This week',
  month: 'This month',
  'last-month': 'Last month',
  quarter: 'This quarter',
  fy: 'This financial year',
  custom: 'Custom range…',
};

/** Resolve a preset (or custom from/to) to an inclusive [from, to] ISO range. */
function dateRangeForPreset(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'week': {
      const diffToMon = (now.getDay() + 6) % 7;
      return {
        from: iso(new Date(y, m, now.getDate() - diffToMon)),
        to: iso(new Date(y, m, now.getDate() - diffToMon + 6)),
      };
    }
    case 'month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'last-month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'quarter': {
      const qs = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, qs, 1)), to: iso(new Date(y, qs + 3, 0)) };
    }
    case 'fy': {
      const startYear = m >= 3 ? y : y - 1;
      return { from: iso(new Date(startYear, 3, 1)), to: iso(new Date(startYear + 1, 2, 31)) };
    }
    case 'custom':
      return { from: customFrom || null, to: customTo || null };
    default:
      return { from: null, to: null };
  }
}

type InvoiceStateFilter = 'all' | InvoiceRow['state'];

const STATE_FILTER_LABEL: Record<InvoiceStateFilter, string> = {
  all: 'All statuses',
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Deleted',
};

type InvoiceSortKey =
  | 'date-desc'
  | 'date-asc'
  | 'amount-desc'
  | 'amount-asc'
  | 'number-desc'
  | 'number-asc';

const SORT_LABEL: Record<InvoiceSortKey, string> = {
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
  'amount-desc': 'Amount: high → low',
  'amount-asc': 'Amount: low → high',
  'number-desc': 'Number: Z → A',
  'number-asc': 'Number: A → Z',
};

const selectClass =
  'border-input bg-background h-9 rounded-md border px-2 text-sm shadow-sm focus-visible:ring-ring focus-visible:ring-1 focus-visible:outline-none';

export type ClientInvoicesSectionProps = {
  clientId: string;
  clientName: string;
  /**
   * Optional opener for a finalized invoice's stored PDF (documentId +
   * documentNumber). OS windows pass a handler that opens a documents
   * window beside; when absent the row falls back to a signed-URL tab.
   */
  onOpenInvoice?: (documentId: string, documentNumber: string) => void;
};

/**
 * GSTR-1 rule: an invoice is deletable in its own month and until the 11th of
 * the following month (inclusive) — after that its GST has been filed.
 */
function gstr1Deadline(documentDate: string): Date {
  const d = new Date(`${documentDate.slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 11));
}

function withinGstr1Window(documentDate: string): boolean {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return today.getTime() <= gstr1Deadline(documentDate).getTime();
}

function gstr1DeadlineLabel(documentDate: string): string {
  return gstr1Deadline(documentDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function ClientInvoicesSection({
  clientId,
  clientName,
  onOpenInvoice,
}: ClientInvoicesSectionProps) {
  const { hasCapability } = useCurrentUser();
  // OS read-only bridge — permissive outside the OS. Compose/theme edits hang
  // off the OS edit grant; voiding an invoice off the delete grant.
  const { canEdit: osCanEdit, canDelete: osCanDelete } = useEntityMutation();
  const canCompose = osCanEdit && hasCapability('create_invoice');
  const canManageThemes = osCanEdit && hasCapability('manage_invoice_themes');
  const canDelete = osCanDelete && hasCapability('void_invoice');
  // Amend & reissue both creates a new invoice AND reverses the original, so it
  // needs compose (create_invoice) plus void_invoice.
  const canAmend = canCompose && hasCapability('void_invoice');

  const [rows, setRows] = useState<readonly InvoiceRow[] | null>(null);
  const [themes, setThemes] = useState<InvoiceThemeSummary[]>([]);
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccountOption[]>([]);
  const [readiness, setReadiness] = useState<ClientBillingReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);
  const [amendTarget, setAmendTarget] = useState<InvoiceRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<InvoiceRow | null>(null);
  // Invoice PDFs uploaded (Documents tab or here) but not yet posted to books.
  const [uploadedDocs, setUploadedDocs] = useState<readonly UnrecordedInvoiceDocument[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [recordDocTarget, setRecordDocTarget] = useState<UnrecordedInvoiceDocument | null>(null);

  // Filter + sort controls for the invoice list.
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<InvoiceStateFilter>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sortKey, setSortKey] = useState<InvoiceSortKey>('date-desc');

  function clearFilters() {
    setQuery('');
    setStateFilter('all');
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
  }

  const reloadInvoices = useCallback(async () => {
    const data = await listInvoices({ clientId });
    // Deleted invoices (ledger reversed within the GSTR-1 window) drop out of
    // the list entirely — the Activity tab keeps their log line.
    setRows(data.rows.filter((r) => r.state !== 'void'));
  }, [clientId]);

  const reloadThemes = useCallback(async () => {
    try {
      setThemes(await listInvoiceThemes());
    } catch {
      // Theme list is non-critical for browsing invoices.
    }
  }, []);

  const reloadReadiness = useCallback(async () => {
    try {
      setReadiness(await getClientBillingReadiness(clientId));
    } catch {
      /* non-fatal */
    }
  }, [clientId]);

  const reloadUploadedDocs = useCallback(async () => {
    try {
      setUploadedDocs(await listUnrecordedClientInvoiceDocuments(clientId));
    } catch {
      /* non-fatal — the pending-uploads strip just stays as-is */
    }
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listInvoices({ clientId }),
      listInvoiceThemes().catch(() => []),
      getClientBillingReadiness(clientId).catch(() => null),
      listCompanyBankAccountOptions().catch(() => []),
      listUnrecordedClientInvoiceDocuments(clientId).catch(() => []),
    ])
      .then(([inv, ths, rdy, banks, upl]) => {
        if (cancelled) return;
        setRows(inv.rows.filter((r) => r.state !== 'void'));
        setThemes(ths);
        setReadiness(rdy);
        setBankAccounts(banks);
        setUploadedDocs(upl);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invoices');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const defaultThemeId = themes.find((t) => t.isDefault)?.id ?? null;

  const billingReady = readiness?.ready ?? false;

  function openNew() {
    if (readiness && !readiness.ready) {
      toast.error(
        `Add this client's ${readiness.missing.join(', ')} before generating an invoice.`,
      );
      return;
    }
    setEditingId(null);
    setComposerOpen(true);
  }
  function openEdit(id: string) {
    setEditingId(id);
    setComposerOpen(true);
  }

  // Proforma → tax invoice: create a separate invoice (new number), keep the
  // proforma, then open the new draft so the operator can review + send it.
  const [convertingId, setConvertingId] = useState<string | null>(null);
  async function handleConvertProforma(proforma: InvoiceRow) {
    setConvertingId(proforma.id);
    try {
      const res = await convertProformaToInvoice(proforma.id);
      await reloadInvoices();
      toast.success(
        res.alreadyConverted
          ? `Proforma ${proforma.documentNumber} was already converted to ${res.documentNumber}.`
          : `Created tax invoice ${res.documentNumber} from proforma ${proforma.documentNumber}.`,
      );
      openEdit(res.invoiceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert the proforma.');
    } finally {
      setConvertingId(null);
    }
  }

  async function downloadSent(row: InvoiceRow) {
    if (!row.sourceDocumentId) {
      toast.error('No PDF stored for this invoice yet.');
      return;
    }
    try {
      const { url } = await getDocumentSignedUrl(row.sourceDocumentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not get download URL');
    }
  }

  async function openUploadedDoc(d: UnrecordedInvoiceDocument) {
    try {
      const { url } = await getDocumentSignedUrl(d.documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the file');
    }
  }

  if (error) {
    return <EmptyState icon={FileTextIcon} title="Could not load invoices" description={error} />;
  }
  if (rows === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full max-w-[160px]" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Apply the toolbar filters + sort. Filtering keeps the full `rows` set for
  // conversion-trail lookups; only the rendered list uses `visibleRows`.
  const { from: dateFrom, to: dateTo } = dateRangeForPreset(datePreset, customFrom, customTo);
  const qlc = query.trim().toLowerCase();
  const filtersActive = qlc !== '' || stateFilter !== 'all' || datePreset !== 'all';
  const visibleRows = rows
    .filter((inv) => {
      if (stateFilter !== 'all' && inv.state !== stateFilter) return false;
      const day = inv.documentDate.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (qlc) {
        const hay = `${inv.documentNumber} ${inv.notes ?? ''}`.toLowerCase();
        if (!hay.includes(qlc)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'date-asc':
          return a.documentDate.localeCompare(b.documentDate);
        case 'amount-desc':
          return a.capturedTotalPaise < b.capturedTotalPaise
            ? 1
            : a.capturedTotalPaise > b.capturedTotalPaise
              ? -1
              : 0;
        case 'amount-asc':
          return a.capturedTotalPaise < b.capturedTotalPaise
            ? -1
            : a.capturedTotalPaise > b.capturedTotalPaise
              ? 1
              : 0;
        case 'number-asc':
          return a.documentNumber.localeCompare(b.documentNumber);
        case 'number-desc':
          return b.documentNumber.localeCompare(a.documentNumber);
        case 'date-desc':
        default:
          return b.documentDate.localeCompare(a.documentDate);
      }
    });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Invoices{' '}
            <span className="text-muted-foreground text-xs font-normal">
              ({filtersActive ? `${visibleRows.length} of ${rows.length}` : rows.length})
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {canManageThemes ? (
              <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
                <PaletteIcon className="mr-1.5 size-4" aria-hidden />
                Manage themes
              </Button>
            ) : null}
            {canCompose ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setUploadOpen(true)}
                title="Upload an invoice PDF and record it in the books"
              >
                <UploadIcon className="mr-1.5 size-4" aria-hidden />
                Upload invoice
              </Button>
            ) : null}
            {canCompose ? (
              <Button
                size="sm"
                onClick={openNew}
                disabled={readiness != null && !billingReady}
                title={
                  readiness != null && !billingReady
                    ? `Add this client's ${readiness.missing.join(', ')} first`
                    : undefined
                }
              >
                <PlusIcon className="mr-1.5 size-4" aria-hidden />
                New invoice
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {canCompose && readiness != null && !billingReady ? (
          <div className="mx-4 mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            To generate invoices for <strong>{clientName}</strong>, add their{' '}
            <strong>{readiness.missing.join(', ')}</strong>. GSTIN &amp; PAN are on the client’s{' '}
            <em>Edit</em> form; the address is on the <em>Addresses</em> tab. They’re optional when
            adding a client but required to bill them.
          </div>
        ) : null}
        <CardContent className="p-0">
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <div className="relative min-w-[160px] flex-1">
                <SearchIcon
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by invoice number or note…"
                  className="h-9 pl-8"
                  aria-label="Search invoices"
                />
              </div>
              <select
                className={selectClass}
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as InvoiceStateFilter)}
                aria-label="Filter by status"
              >
                {(Object.keys(STATE_FILTER_LABEL) as InvoiceStateFilter[])
                  .filter((s) => s !== 'void')
                  .map((s) => (
                    <option key={s} value={s}>
                      {STATE_FILTER_LABEL[s]}
                    </option>
                  ))}
              </select>
              <select
                className={selectClass}
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                aria-label="Filter by date"
              >
                {(Object.keys(DATE_PRESET_LABEL) as DatePreset[]).map((p) => (
                  <option key={p} value={p}>
                    {DATE_PRESET_LABEL[p]}
                  </option>
                ))}
              </select>
              {datePreset === 'custom' ? (
                <>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-9 w-[150px]"
                    aria-label="From date"
                  />
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-9 w-[150px]"
                    aria-label="To date"
                  />
                </>
              ) : null}
              <select
                className={selectClass}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as InvoiceSortKey)}
                aria-label="Sort invoices"
              >
                {(Object.keys(SORT_LABEL) as InvoiceSortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </select>
              {filtersActive ? (
                <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                  Clear
                </Button>
              ) : null}
            </div>
          ) : null}
          {uploadedDocs.length > 0 ? (
            <div className="bg-muted/20 border-b px-4 py-3">
              <div className="text-muted-foreground mb-2 text-xs font-medium">
                Uploaded — not in books ({uploadedDocs.length})
              </div>
              <ul className="flex flex-col gap-1.5">
                {uploadedDocs.map((d) => (
                  <li
                    key={d.documentId}
                    className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 text-left"
                      onClick={() => void openUploadedDoc(d)}
                      title="Open the uploaded file"
                    >
                      <UploadIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span className="truncate text-sm">
                        {d.title || d.originalFilename || 'Uploaded invoice'}
                      </span>
                    </button>
                    {canCompose ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setRecordDocTarget(d)}
                        disabled={readiness != null && !billingReady}
                        title={
                          readiness != null && !billingReady
                            ? `Add this client's ${readiness.missing.join(', ')} first`
                            : 'Record this invoice in the books'
                        }
                      >
                        <FileCheck2Icon className="mr-1.5 size-4" aria-hidden />
                        Record in books
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {rows.length === 0 && uploadedDocs.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="No invoices yet"
              description={`Generate a themed GST invoice for ${clientName}, preview it, then save & download.`}
            />
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground px-4 py-6 text-center text-sm">
              No invoices in the books yet.
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-6 text-center text-sm">
              <span>No invoices match these filters.</span>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {visibleRows.map((inv) => {
                // Conversion trail (0062): a converted tax invoice carries its
                // source proforma's id; the proforma finds its successor by
                // the reverse lookup. Both usually sit in this same list.
                const convertedFrom = inv.convertedFromInvoiceId
                  ? (rows.find((r) => r.id === inv.convertedFromInvoiceId) ?? null)
                  : null;
                const convertedTo =
                  inv.documentType === 'proforma'
                    ? (rows.find((r) => r.convertedFromInvoiceId === inv.id) ?? null)
                    : null;
                // Row click opens the invoice: drafts open the composer
                // (edit/preview); finalized invoices open their stored PDF.
                const isEditableDraft = inv.state === 'draft' && canCompose;
                const clickable = isEditableDraft || Boolean(inv.sourceDocumentId);
                const openRow = () => {
                  if (isEditableDraft) {
                    openEdit(inv.id);
                    return;
                  }
                  if (!inv.sourceDocumentId) return;
                  if (onOpenInvoice) {
                    onOpenInvoice(inv.sourceDocumentId, inv.documentNumber);
                  } else {
                    void downloadSent(inv);
                  }
                };
                return (
                  <li
                    key={inv.id}
                    className={`hover:bg-muted/30 flex items-center justify-between gap-3 px-4 py-3 ${clickable ? 'cursor-pointer' : ''}`}
                    onClick={clickable ? openRow : undefined}
                    title={
                      isEditableDraft
                        ? `Open draft ${inv.documentNumber} in the composer`
                        : inv.sourceDocumentId
                          ? `Open invoice ${inv.documentNumber}`
                          : undefined
                    }
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <FileTextIcon
                        className="text-muted-foreground mt-0.5 size-4 shrink-0"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="truncate">{inv.documentNumber}</span>
                          <StatusBadge
                            tone={STATE_TONE[inv.state]}
                            label={STATE_LABEL[inv.state]}
                            dot={false}
                          />
                          {inv.documentType === 'proforma' ? (
                            <StatusBadge tone="neutral" label="Proforma" dot={false} />
                          ) : null}
                          {inv.coveredUnderRetainer ? (
                            <StatusBadge tone="neutral" label="Retainer" dot={false} />
                          ) : null}
                          {inv.amendedFromInvoiceId ? (
                            <button
                              type="button"
                              className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHistoryTarget(inv);
                              }}
                              title={
                                inv.amendedFromDocumentNumber
                                  ? `Reissue of ${inv.amendedFromDocumentNumber} — click for the amendment history`
                                  : 'Reissue of an amended invoice — click for the amendment history'
                              }
                              aria-label="View amendment history"
                            >
                              <StatusBadge
                                tone="info"
                                label={
                                  inv.amendedFromDocumentNumber
                                    ? `Reissue of ${inv.amendedFromDocumentNumber}`
                                    : 'Reissue'
                                }
                                dot={false}
                              />
                            </button>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-xs">
                          {formatINR(inv.capturedTotalPaise)}
                          {' · '}
                          {inv.documentDate}
                          {inv.dueDate ? ` · due ${inv.dueDate}` : ''}
                          {convertedFrom ? ` · from proforma ${convertedFrom.documentNumber}` : ''}
                          {inv.convertedFromInvoiceId && !convertedFrom
                            ? ' · converted from a proforma'
                            : ''}
                          {convertedTo ? ` · → converted to ${convertedTo.documentNumber}` : ''}
                        </div>
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inv.state === 'draft' && canCompose ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(inv.id)}
                          aria-label="Edit / preview draft"
                        >
                          <PencilIcon className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      {inv.sourceDocumentId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void downloadSent(inv)}
                          aria-label="Download invoice PDF"
                        >
                          <DownloadIcon className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      {inv.documentType === 'proforma' && canCompose ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleConvertProforma(inv)}
                          disabled={convertingId === inv.id}
                          title="Convert to a tax invoice (creates a new invoice; keeps this proforma)"
                          aria-label="Convert proforma to tax invoice"
                        >
                          <FileCheck2Icon className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      {inv.state === 'sent' && inv.documentType === 'invoice' && canAmend ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setAmendTarget(inv)}
                          title="Amend & reissue — reverses this invoice and opens an editable reissue"
                          aria-label="Amend and reissue invoice"
                        >
                          <FilePenIcon className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      {canDelete && inv.state !== 'void' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(inv)}
                          disabled={inv.state === 'paid' || !withinGstr1Window(inv.documentDate)}
                          title={
                            inv.state === 'paid'
                              ? 'Paid invoices can’t be deleted — issue a credit note.'
                              : !withinGstr1Window(inv.documentDate)
                                ? `GSTR-1 window closed on ${gstr1DeadlineLabel(inv.documentDate)} — issue a credit note instead.`
                                : inv.state === 'draft'
                                  ? 'Delete draft invoice'
                                  : `Delete — allowed until ${gstr1DeadlineLabel(inv.documentDate)} (GSTR-1 filing)`
                          }
                          aria-label="Delete invoice"
                        >
                          <Trash2Icon className="text-destructive size-4" aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canCompose ? (
        <InvoiceComposerDialog
          open={composerOpen}
          onOpenChange={setComposerOpen}
          clientId={clientId}
          clientName={clientName}
          clientStateCode={readiness?.stateCode ?? null}
          themes={themes}
          defaultThemeId={defaultThemeId}
          bankAccounts={bankAccounts}
          existingInvoiceId={editingId}
          onFinalized={() => {
            void reloadInvoices();
            void reloadReadiness();
            void reloadUploadedDocs();
          }}
        />
      ) : null}

      {canCompose ? (
        <UploadInvoiceDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          clientId={clientId}
          clientName={clientName}
          readiness={readiness}
          onDone={() => {
            void reloadInvoices();
            void reloadUploadedDocs();
            void reloadReadiness();
          }}
        />
      ) : null}

      {canCompose ? (
        <UploadInvoiceDialog
          open={recordDocTarget !== null}
          onOpenChange={(o) => !o && setRecordDocTarget(null)}
          clientId={clientId}
          clientName={clientName}
          readiness={readiness}
          existingDocumentId={recordDocTarget?.documentId ?? null}
          existingLabel={recordDocTarget?.title || recordDocTarget?.originalFilename || null}
          onDone={() => {
            setRecordDocTarget(null);
            void reloadInvoices();
            void reloadUploadedDocs();
          }}
        />
      ) : null}

      {canManageThemes ? (
        <ManageThemesDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          themes={themes}
          onChanged={() => void reloadThemes()}
        />
      ) : null}

      <DeleteInvoiceDialog
        target={deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onDone={() => {
          setDeleteTarget(null);
          void reloadInvoices();
          void reloadReadiness();
        }}
      />

      {canAmend ? (
        <AmendInvoiceDialog
          target={amendTarget}
          onOpenChange={(o) => !o && setAmendTarget(null)}
          onDone={(reissueId) => {
            setAmendTarget(null);
            void reloadInvoices();
            openEdit(reissueId);
          }}
        />
      ) : null}

      <AmendmentHistoryDialog
        target={historyTarget}
        onOpenChange={(o) => !o && setHistoryTarget(null)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete / void invoice dialog                                               */
/* -------------------------------------------------------------------------- */

/**
 * One affordance that adapts to the invoice's state:
 *  - draft (incl. proforma drafts) → hard-delete via deleteDraftInvoice.
 *  - sent / partially_paid → the invoice is posted to the append-only ledger, so
 *    "delete" voids it (voidInvoice reverses the ledger entry); a reason is
 *    required. paid invoices are blocked upstream (button disabled).
 */
function DeleteInvoiceDialog({
  target,
  onOpenChange,
  onDone,
}: {
  target: InvoiceRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) queueMicrotask(() => setReason(''));
  }, [target]);

  if (!target) return null;
  const isDraft = target.state === 'draft';

  async function submit() {
    if (!isDraft && reason.trim().length < 10) {
      toast.error('Enter a reason of at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      if (isDraft) {
        await deleteDraftInvoice(target!.id);
        toast.success(`Deleted ${target!.documentNumber}.`);
      } else {
        await voidInvoice(target!.id, reason.trim());
        toast.success(`Deleted ${target!.documentNumber} and reversed its ledger entry.`);
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isDraft ? 'Delete draft invoice?' : 'Delete invoice?'}</DialogTitle>
          <DialogDescription>
            {isDraft ? (
              <>
                This permanently deletes <strong>{target.documentNumber}</strong>
                {target.documentType === 'proforma' ? ' (proforma)' : ''} and its line items. This
                can’t be undone.
              </>
            ) : (
              <>
                Deleting <strong>{target.documentNumber}</strong> reverses its ledger entry and
                removes it from this list. Invoices can be deleted until the{' '}
                <strong>11th of the following month</strong> — after that the GSTR-1 covering them
                is filed and a credit note is the correct fix. Give a reason.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!isDraft ? (
          <Textarea
            rows={3}
            placeholder="e.g. Superseded by the final tax invoice"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Amend & reissue dialog                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Amend a SENT tax invoice: reverses the original's ledger posting, marks it
 * deleted, and spins up an editable DRAFT reissue (fresh number) carrying its
 * lines. On success the parent reloads the list and opens the reissue in the
 * composer so the operator can correct it and send it (a fresh ledger post).
 */
function AmendInvoiceDialog({
  target,
  onOpenChange,
  onDone,
}: {
  target: InvoiceRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: (reissueId: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) queueMicrotask(() => setReason(''));
  }, [target]);

  if (!target) return null;

  async function submit() {
    if (reason.trim().length < 10) {
      toast.error('Enter a reason of at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      const result = await amendInvoice(target!.id, reason.trim());
      toast.success(`Reissued as ${result.documentNumber} — edit and send it.`);
      onDone(result.invoiceId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not amend the invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Amend &amp; reissue invoice?</DialogTitle>
          <DialogDescription>
            This reverses <strong>{target.documentNumber}</strong>’s ledger entry, marks it deleted,
            and creates a fresh editable draft (new number) carrying its lines. Correct the reissue
            and send it to post again — the original stays on record. Give a reason.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          rows={3}
          placeholder="e.g. Wrong GST rate on the design line — reissuing corrected"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Reissuing…' : 'Amend & reissue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Amendment history dialog                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Field-level line diff between two consecutive chain versions, keyed by line
 * number: `+` added, `−` removed, `~` changed (qty or rate). Description-only
 * changes also surface as `~`.
 */
function describeLineDiff(
  prev: readonly InvoiceAmendmentChainLine[],
  curr: readonly InvoiceAmendmentChainLine[],
): string[] {
  const out: string[] = [];
  const prevByNo = new Map(prev.map((l) => [l.lineNo, l]));
  const currByNo = new Map(curr.map((l) => [l.lineNo, l]));
  for (const l of curr) {
    const p = prevByNo.get(l.lineNo);
    if (!p) {
      out.push(`+ ${l.description} · ${l.qty} × ${formatINR(BigInt(l.ratePaise))}`);
    } else if (
      p.description !== l.description ||
      p.qty !== l.qty ||
      p.ratePaise !== l.ratePaise ||
      p.taxAmountPaise !== l.taxAmountPaise
    ) {
      out.push(
        `~ ${l.description}: ${p.qty} × ${formatINR(BigInt(p.ratePaise))} → ${l.qty} × ${formatINR(
          BigInt(l.ratePaise),
        )}`,
      );
    }
  }
  for (const p of prev) {
    if (!currByNo.has(p.lineNo)) out.push(`− ${p.description} (removed)`);
  }
  return out;
}

/**
 * Scrollable list of the full amendment chain (oldest → newest) for an amended
 * invoice. The live (non-deleted) tip is marked "Current". Each reissue beyond
 * the original shows its captured amendment reason and a field-level diff
 * (total, place of supply, line changes) versus the version it replaced.
 */
function AmendmentHistoryDialog({
  target,
  onOpenChange,
}: {
  target: InvoiceRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [chain, setChain] = useState<readonly InvoiceAmendmentChainEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    // Reset to the loading state off the synchronous effect body (react-hooks
    // set-state-in-effect), then fetch the chain.
    queueMicrotask(() => {
      if (cancelled) return;
      setChain(null);
      setError(null);
    });
    getInvoiceAmendmentChain(target.id)
      .then((c) => {
        if (!cancelled) setChain(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load history');
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Amendment history</DialogTitle>
          <DialogDescription>
            The full chain, oldest first: the original invoice, then each reissue. Earlier versions
            were cancelled (reversed) when reissued; the live one is marked Current. Each reissue
            shows the reason it was amended and exactly what changed from the version before it.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="text-destructive text-sm">{error}</div>
        ) : chain === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : chain.length === 0 ? (
          <div className="text-muted-foreground text-sm">No amendment history.</div>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
            {chain.map((entry, i) => {
              const state = entry.state as InvoiceRow['state'];
              const prev = i > 0 ? chain[i - 1] : null;
              const totalChanged =
                prev != null && prev.capturedTotalPaise !== entry.capturedTotalPaise;
              const posChanged =
                prev != null && (prev.placeOfSupply ?? '') !== (entry.placeOfSupply ?? '');
              const lineChanges = prev != null ? describeLineDiff(prev.lines, entry.lines) : [];
              return (
                <li key={entry.id} className="flex flex-col gap-1.5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{entry.documentNumber}</span>
                      <StatusBadge
                        tone={STATE_TONE[state]}
                        label={STATE_LABEL[state]}
                        dot={false}
                      />
                      {i === 0 ? <StatusBadge tone="neutral" label="Original" dot={false} /> : null}
                      {entry.isCurrent ? (
                        <StatusBadge tone="success" label="Current" dot={false} />
                      ) : null}
                    </div>
                    <div className="text-muted-foreground shrink-0 text-right text-xs">
                      <div>{formatINR(BigInt(entry.capturedTotalPaise))}</div>
                      <div>{entry.documentDate}</div>
                    </div>
                  </div>
                  {entry.reason ? (
                    <div className="text-muted-foreground text-xs">
                      <span className="font-medium">Reason:</span> {entry.reason}
                    </div>
                  ) : null}
                  {prev != null && (totalChanged || posChanged || lineChanges.length > 0) ? (
                    <div className="text-muted-foreground bg-muted/40 rounded px-2 py-1 text-[11px] leading-relaxed">
                      <div className="mb-0.5 font-medium">Changes vs {prev.documentNumber}</div>
                      {totalChanged ? (
                        <div>
                          Total: {formatINR(BigInt(prev.capturedTotalPaise))} →{' '}
                          {formatINR(BigInt(entry.capturedTotalPaise))}
                        </div>
                      ) : null}
                      {posChanged ? (
                        <div>
                          Place of supply: {prev.placeOfSupply ?? '—'} →{' '}
                          {entry.placeOfSupply ?? '—'}
                        </div>
                      ) : null}
                      {lineChanges.map((c, ci) => (
                        <div key={ci}>{c}</div>
                      ))}
                    </div>
                  ) : prev != null ? (
                    <div className="text-muted-foreground bg-muted/40 rounded px-2 py-1 text-[11px] leading-relaxed italic">
                      No field changes yet — this reissue is still an unedited copy of{' '}
                      {prev.documentNumber}. Edit and send it to record the correction.
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
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

/* -------------------------------------------------------------------------- */
/* Manage themes dialog                                                       */
/* -------------------------------------------------------------------------- */

function ManageThemesDialog({
  open,
  onOpenChange,
  themes,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themes: InvoiceThemeSummary[];
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setFile(null);
      setName('');
      setMakeDefault(false);
    });
  }, [open]);

  async function upload() {
    if (!file) {
      toast.error('Pick a .docx file first.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (name.trim()) fd.append('name', name.trim());
      if (makeDefault) fd.append('isDefault', 'true');
      await uploadDocxTheme(fd);
      toast.success('Theme imported from .docx.');
      setFile(null);
      setName('');
      setMakeDefault(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not import theme');
    } finally {
      setBusy(false);
    }
  }

  async function makeThemeDefault(id: string) {
    try {
      await setDefaultTheme(id);
      toast.success('Default theme updated.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set default');
    }
  }

  async function removeTheme(id: string) {
    try {
      await deleteInvoiceTheme(id);
      toast.success('Theme deleted.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete theme');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invoice themes</DialogTitle>
          <DialogDescription>
            Built-in themes plus any you import from a <code>.docx</code>. Brand colours, a font,
            and the first embedded logo are pulled from the document and applied to the generated
            PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Existing themes */}
          <ul className="divide-y rounded-md border">
            {themes.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-4 shrink-0 rounded-full border"
                    style={{ background: t.primaryColor ?? 'var(--muted)' }}
                    aria-hidden
                  />
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t.kind === 'builtin' ? 'Built-in' : 'Imported'}
                  </span>
                  {t.isDefault ? <StatusBadge tone="success" label="Default" dot={false} /> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!t.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void makeThemeDefault(t.id)}
                      aria-label="Set as default"
                    >
                      <StarIcon className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                  {t.kind === 'docx' && !t.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeTheme(t.id)}
                      aria-label="Delete theme"
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {/* Import a .docx */}
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="theme-file">Import theme from .docx</Label>
            <Input
              id="theme-file"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <Input
              placeholder="Theme name (optional — defaults to filename)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={makeDefault}
                onCheckedChange={(v) => setMakeDefault(v === true)}
                disabled={busy}
              />
              Set as default theme
            </label>
            <Button size="sm" onClick={upload} disabled={busy || !file}>
              <UploadIcon className="mr-1.5 size-4" aria-hidden />
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
