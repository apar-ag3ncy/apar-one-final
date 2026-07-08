'use client';

import { useState, useTransition } from 'react';
import { CircleCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/shared/date-field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ValidationFlags } from './validation-flags';
import { TransactionLineItems, type TransactionLineItem } from './transaction-line-items';
import type { TransactionFlag } from './transaction-detail';
import type { TransactionKind } from './transaction-list';

type Hook = ReturnType<typeof useState<unknown>>;

export type SimpleTransactionFormField = {
  id: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'amount' | 'memo';
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  /** Use the consumer-supplied state hook to wire the field. */
  hook?: Hook;
};

export type SimpleTransactionFormProps = {
  kind: TransactionKind;
  /** Sections of free-form fields above the line items. */
  fields: readonly SimpleTransactionFormField[];
  /** Whether the form has line items (most do; payment forms don't). */
  showLineItems?: boolean;
  /** Whether line items show GST captures. */
  showLineGst?: boolean;
  /** Whether line items show HSN code column. */
  showLineHsn?: boolean;
  /** Whether line items show TDS section column. */
  showLineTds?: boolean;
  /** Initial lines (default one empty row). */
  initialLines?: readonly TransactionLineItem[];
  /** Title shown above. */
  title?: string;
  /** Help text under the title. */
  description?: React.ReactNode;
  /** Source-document upload required? Default true. */
  requireSourceDocument?: boolean;
  /** Called when the user clicks "Create draft". Returns flags. */
  onCreateDraft: (args: {
    fieldValues: Record<string, string>;
    lines: readonly TransactionLineItem[];
    sourceDocumentId?: string;
    memo: string;
  }) => Promise<{ draftId: string; flags: readonly TransactionFlag[] }>;
  /** Called when the user clicks "Post". */
  onPost: (args: {
    draftId: string;
    acknowledgedFlagIds: readonly string[];
  }) => Promise<{ ok: true; transactionId: string } | { ok: false; message: string }>;
  /** Called when the user clicks "Back" after a successful post. */
  onSuccessHref?: string;
};

const EMPTY_LINE: TransactionLineItem = {
  description: '',
  hsn: '',
  quantity: 1,
  unitPricePaise: 0n,
  gstPct: 0,
};

/**
 * The minimal "draft → flags → ack → post" workflow used by most transaction
 * kinds (payment received, payment made, advance, expense on behalf, salary
 * line, office expense, inter-bank transfer, partner cap/draw).
 *
 * The richer vendor-bill flow with attribution-card UI is its own component.
 */
export function SimpleTransactionForm({
  kind: _kind,
  fields,
  showLineItems = true,
  showLineGst = false,
  showLineHsn = false,
  showLineTds = false,
  initialLines,
  title,
  description,
  requireSourceDocument = false,
  onCreateDraft,
  onPost,
  onSuccessHref,
}: SimpleTransactionFormProps) {
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<readonly TransactionLineItem[]>(
    initialLines ?? [{ ...EMPTY_LINE }],
  );
  const [memo, setMemo] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState<string | undefined>();
  const [sourceDocumentName, setSourceDocumentName] = useState('');

  const [draft, setDraft] = useState<{ id: string; flags: readonly TransactionFlag[] } | null>(
    null,
  );
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [postMessage, setPostMessage] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);

  const blockFlags = draft?.flags.filter((f) => f.severity === 'block') ?? [];
  const warnFlags = draft?.flags.filter((f) => f.severity === 'warn') ?? [];
  const allWarnsAcked = warnFlags.every((f) => acked.has(f.id));
  const canPost = draft !== null && blockFlags.length === 0 && allWarnsAcked && !pending;

  function setField(id: string, value: string) {
    setValues((v) => ({ ...v, [id]: value }));
  }

  function handleCreateDraft() {
    setDraft(null);
    setAcked(new Set());
    setPostMessage(null);
    startTransition(async () => {
      const result = await onCreateDraft({
        fieldValues: values,
        lines,
        memo,
        sourceDocumentId,
      });
      setDraft({ id: result.draftId, flags: result.flags });
    });
  }

  function handlePost() {
    if (!draft) return;
    setPostMessage(null);
    startTransition(async () => {
      const result = await onPost({
        draftId: draft.id,
        acknowledgedFlagIds: Array.from(acked),
      });
      if (result.ok) {
        setPostedId(result.transactionId);
      } else {
        setPostMessage(result.message);
      }
    });
  }

  if (postedId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleCheckIcon className="size-10 text-emerald-500" aria-hidden />
          <h2 className="text-lg font-semibold">{title ?? 'Transaction'} posted</h2>
          <p className="text-muted-foreground text-sm">
            Transaction id <span className="font-mono">{postedId}</span>.
          </p>
          {onSuccessHref ? (
            <Button asChild variant="outline">
              <a href={onSuccessHref}>Back to ledger</a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30">
        <CardContent className="py-3 text-sm">
          <p className="font-medium">Typed-input form coming in a follow-up</p>
          <p className="text-muted-foreground mt-1 text-xs">
            This form still uses the legacy flat-payload shape — the real backend needs a per-kind
            typed input (line items with paise bigints, real entity UUIDs for clients / vendors /
            bank accounts, an attached source document). The typed form ships in a follow-up. To
            record this transaction now, use the{' '}
            <a className="underline" href="/ledger/new/journal-voucher">
              Journal Voucher
            </a>{' '}
            — it accepts any debit/credit pair against the real chart of accounts and posts to the
            live ledger immediately.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                value={values[field.id] ?? ''}
                onChange={(v) => setField(field.id, v)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {showLineItems ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items</CardTitle>
          </CardHeader>
          <CardContent>
            <TransactionLineItems
              items={lines}
              onChange={setLines}
              showGst={showLineGst}
              showHsn={showLineHsn}
              showTds={showLineTds}
            />
          </CardContent>
        </Card>
      ) : null}

      {requireSourceDocument ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source document</CardTitle>
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
              <Button
                variant="outline"
                onClick={() => {
                  setSourceDocumentName('uploaded-receipt.pdf');
                  setSourceDocumentId('doc_simulated_' + Math.random().toString(36).slice(2, 8));
                }}
              >
                Simulate upload
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {draft ? (
        <ValidationFlags
          flags={draft.flags}
          acknowledgedIds={acked}
          onAcknowledgeToggle={(id) =>
            setAcked((s) => {
              const next = new Set(s);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      ) : null}

      {postMessage ? (
        <Card className="border-destructive">
          <CardContent className="text-destructive py-3 text-sm">{postMessage}</CardContent>
        </Card>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <Textarea
          className="max-w-md"
          rows={2}
          placeholder="Memo / narration"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        {draft === null ? (
          <Button onClick={handleCreateDraft} disabled={pending}>
            {pending ? 'Creating draft…' : 'Create draft & validate'}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>
              Edit
            </Button>
            <Button onClick={handlePost} disabled={!canPost}>
              {pending ? 'Posting…' : 'Post transaction'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SimpleTransactionFormField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs tracking-wide uppercase">
        {field.label}
        {field.required ? <span className="text-destructive ml-1">*</span> : null}
      </Label>
      {field.type === 'select' ? (
        <select
          className="bg-background h-9 rounded-md border px-3 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === 'date' ? (
        <DateField value={value} onChange={(next) => onChange(next)} clearable={!field.required} />
      ) : field.type === 'amount' ? (
        <Input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
