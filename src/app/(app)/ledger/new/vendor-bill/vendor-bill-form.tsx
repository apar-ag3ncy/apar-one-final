'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheckIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  TransactionLineItems,
  type TransactionLineItem,
} from '@/components/entity/transaction-line-items';
import { ValidationFlags } from '@/components/entity/validation-flags';
import type { TransactionFlag } from '@/components/entity/transaction-detail';
import { createDraftTransaction, postTransaction } from '@/lib/server-stub/ledger-actions';
import { uploadDocument } from '@/lib/server/entities/entity-documents';
import { notify } from '@/lib/client/toast';

type VendorOption = { id: string; name: string };
type ClientOption = { id: string; name: string };
type ProjectOption = { id: string; clientId: string; code: string; name: string };

export type VendorBillFormProps = {
  vendors: readonly VendorOption[];
  clients: readonly ClientOption[];
  projects: readonly ProjectOption[];
};

type Attribution = 'client' | 'opex' | 'asset' | null;

const EMPTY_LINE: TransactionLineItem = {
  description: '',
  hsn: '',
  quantity: 1,
  unitPricePaise: 0n,
  gstPct: 18,
};

// 6xxx expense accounts from the chart of accounts (LEDGER-SPEC v2 §2).
const EXPENSE_ACCOUNTS = [
  { code: '6100', name: 'Rent' },
  { code: '6200', name: 'Utilities' },
  { code: '6300', name: 'Salaries' },
  { code: '6400', name: 'Software & SaaS' },
  { code: '6900', name: 'Other operating expense' },
  { code: '8100', name: 'Finance cost / bank charges' },
];

export function VendorBillForm({ vendors, clients, projects }: VendorBillFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [vendorId, setVendorId] = useState('');
  const [attribution, setAttribution] = useState<Attribution>(null);
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [expenseAccountCode, setExpenseAccountCode] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<readonly TransactionLineItem[]>([{ ...EMPTY_LINE }]);
  const [sourceDocumentName, setSourceDocumentName] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState<string | undefined>();

  const [draft, setDraft] = useState<{ id: string; flags: readonly TransactionFlag[] } | null>(
    null,
  );
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [postMessage, setPostMessage] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);
  const blockFlags = draft?.flags.filter((f) => f.severity === 'block') ?? [];
  const warnFlags = draft?.flags.filter((f) => f.severity === 'warn') ?? [];
  const allWarnsAcked = warnFlags.every((f) => acked.has(f.id));
  const canPost = draft !== null && blockFlags.length === 0 && allWarnsAcked && !pending;

  async function handleUploadFile(file: File) {
    if (!vendorId) {
      notify.error('Pick a vendor first', 'The bill is filed against the selected vendor.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('entityType', 'vendor');
      fd.set('entityId', vendorId);
      fd.set('kind', 'invoice');
      if (billNumber.trim()) fd.set('title', billNumber.trim());
      const { documentId } = await uploadDocument(fd);
      setSourceDocumentId(documentId);
      setSourceDocumentName(file.name);
      notify.success('Bill attached', file.name);
    } catch (e) {
      notify.error('Upload failed', e instanceof Error ? e.message : 'Could not attach the bill.');
    } finally {
      setUploading(false);
    }
  }

  function handleAttributionChange(next: Exclude<Attribution, null>) {
    setAttribution(next);
    setClientId('');
    setProjectId('');
    setExpenseAccountCode('');
    setDraft(null);
    setAcked(new Set());
  }

  function handleCreateDraft() {
    setDraft(null);
    setAcked(new Set());
    setPostMessage(null);
    startTransition(async () => {
      const result = await createDraftTransaction({
        kind: 'vendor_bill',
        attribution: attribution ?? undefined,
        clientId: attribution === 'client' ? clientId || undefined : undefined,
        projectId: attribution === 'client' ? projectId || undefined : undefined,
        expenseAccountCode: attribution === 'opex' ? expenseAccountCode || undefined : undefined,
        vendorId: vendorId || undefined,
        sourceDocumentId,
        billNumber: billNumber || undefined,
        billDate,
        memo: memo || undefined,
        lines: lines.map((l) => ({
          description: l.description,
          hsn: l.hsn,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          gstPct: l.gstPct,
          tdsSection: l.tdsSection,
        })),
      });
      setDraft({ id: result.draftId, flags: result.flags });
    });
  }

  function handlePost() {
    if (!draft) return;
    setPostMessage(null);
    startTransition(async () => {
      const result = await postTransaction({
        draftId: draft.id,
        acknowledgedFlagIds: Array.from(acked),
      });
      if (result.ok) {
        setPostedId(result.transactionId);
        notify.success('Vendor bill posted', `Reference: ${result.transactionId}`);
      } else {
        setPostMessage(result.message);
        notify.error('Posting failed', result.message);
      }
    });
  }

  function toggleAck(flagId: string) {
    setAcked((current) => {
      const next = new Set(current);
      if (next.has(flagId)) next.delete(flagId);
      else next.add(flagId);
      return next;
    });
  }

  if (postedId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleCheckIcon className="size-10 text-emerald-500" aria-hidden />
          <h2 className="text-lg font-semibold">Vendor bill posted</h2>
          <p className="text-muted-foreground text-sm">
            Transaction id <span className="font-mono">{postedId}</span>.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/ledger')}>
              Back to ledger
            </Button>
            <Button onClick={() => router.refresh()}>Create another</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Step 1: Vendor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Vendor" required>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose vendor…" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Step 2: Attribution — THE critical question */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Is this bill for a client, OpEx, or an asset?</CardTitle>
          <p className="text-muted-foreground text-xs">
            No default — choose one. Per LEDGER-SPEC §0.6 the answer determines which GL account the
            cost lands in, and per-client P&L is computed from this attribution alone.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <AttributionCard
              value="client"
              current={attribution}
              onSelect={handleAttributionChange}
              title="For a client"
              description="Posts to direct project cost (5100). Required: client. Optional: project."
            />
            <AttributionCard
              value="opex"
              current={attribution}
              onSelect={handleAttributionChange}
              title="OpEx"
              description="Posts to an expense account in the 6xxx range. Required: account."
            />
            <AttributionCard
              value="asset"
              current={attribution}
              onSelect={handleAttributionChange}
              title="Asset"
              description="Posts to fixed assets (1510)."
            />
          </div>

          {attribution === 'client' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client" required>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose client…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project (optional)">
                <Select value={projectId} onValueChange={setProjectId} disabled={!clientId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={clientId ? 'Choose project…' : 'Pick a client first'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {projectsForClient.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}

          {attribution === 'opex' ? (
            <Field label="Expense account" required>
              <Select value={expenseAccountCode} onValueChange={setExpenseAccountCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose 6xxx account…" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_ACCOUNTS.map((a) => (
                    <SelectItem key={a.code} value={a.code}>
                      <span className="font-mono">{a.code}</span> — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {attribution === 'asset' ? (
            <p className="text-muted-foreground bg-muted/40 rounded-md p-3 text-xs">
              Will post to <span className="font-mono">1510 — Fixed Assets</span>. Depreciation
              schedule (LEDGER-SPEC v2 defers to v2 product release) is captured separately on the
              asset detail page, not on this transaction.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 3: bill meta */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Bill number" required>
              <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
            </Field>
            <Field label="Bill date" required>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Memo">
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Step 4: line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionLineItems items={lines} onChange={setLines} showTds />
        </CardContent>
      </Card>

      {/* Step 5: source document */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source document</CardTitle>
          <p className="text-muted-foreground text-xs">
            Upload the PDF or image of the actual bill from the vendor. Optional — leave blank to
            record the bill now and attach the scan later from the vendor&apos;s Documents tab.
          </p>
        </CardHeader>
        <CardContent>
          {sourceDocumentName ? (
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                Attached: <span className="font-mono">{sourceDocumentName}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSourceDocumentName('');
                  setSourceDocumentId(undefined);
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadFile(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                disabled={uploading || !vendorId}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon className="mr-1.5 size-3.5" aria-hidden />
                {uploading ? 'Uploading…' : 'Upload bill (PDF / image)'}
              </Button>
              {!vendorId ? (
                <span className="text-muted-foreground text-xs">Choose a vendor first.</span>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 6: validation flags + post */}
      {draft ? (
        <ValidationFlags
          flags={draft.flags}
          acknowledgedIds={acked}
          onAcknowledgeToggle={toggleAck}
        />
      ) : null}

      {postMessage ? (
        <Card className="border-destructive">
          <CardContent className="text-destructive py-3 text-sm">{postMessage}</CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Textarea
          className="max-w-md"
          rows={2}
          placeholder="Reason / narration (free-text)"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <div className="flex items-center gap-2">
          {draft === null ? (
            <Button onClick={handleCreateDraft} disabled={pending}>
              {pending ? 'Creating draft…' : 'Create draft & validate'}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                Edit
              </Button>
              <Button onClick={handlePost} disabled={!canPost}>
                {pending ? 'Posting…' : 'Post transaction'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AttributionCard({
  value,
  current,
  onSelect,
  title,
  description,
}: {
  value: Exclude<Attribution, null>;
  current: Attribution;
  onSelect: (v: Exclude<Attribution, null>) => void;
  title: string;
  description: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-md border p-3 text-left transition-colors ${
        active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
      }`}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-xs">{description}</p>
    </button>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs tracking-wide uppercase">
        {label}
        {required ? <span className="text-destructive ml-1">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
