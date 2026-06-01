'use client';

import { FileUpIcon, PaperclipIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DOCUMENT_KIND_OPTIONS,
  isKycKind,
  newDocumentDraft,
  type CreationEntityType,
  type DocumentDraft,
  type DocumentKind,
} from './types';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx';

export type PriorRecordsStepProps = {
  entityType: CreationEntityType;
  documents: DocumentDraft[];
  onChange: (documents: DocumentDraft[]) => void;
  /** Whether to show the amount column (invoices/receipts). Default true. */
  showAmount?: boolean;
};

/**
 * Reusable "Prior records & documents" wizard step. Holds `File` objects in
 * the wizard's value bag; the post-create orchestrator uploads them once the
 * entity exists. Captured-not-computed: amount + date are stored as metadata
 * on the document, never turned into a ledger posting here.
 */
export function PriorRecordsStep({
  entityType,
  documents,
  onChange,
  showAmount = true,
}: PriorRecordsStepProps) {
  const options = DOCUMENT_KIND_OPTIONS[entityType];

  function patch(uid: string, p: Partial<DocumentDraft>) {
    onChange(documents.map((d) => (d.uid === uid ? { ...d, ...p } : d)));
  }
  function remove(uid: string) {
    onChange(documents.filter((d) => d.uid !== uid));
  }
  function add() {
    onChange([...documents, newDocumentDraft(options[0]!.value)]);
  }

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground text-sm">
        Attach previous invoices, contracts, receipts and other documents. Each file is filed
        against the new {entityType} as soon as it&apos;s created — nothing is posted to the ledger
        here. This step is optional.
      </div>

      {documents.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="border-border hover:border-primary/50 hover:bg-muted/40 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors"
        >
          <FileUpIcon className="text-muted-foreground size-6" aria-hidden />
          <span className="text-sm font-medium">Add a document</span>
          <span className="text-muted-foreground text-xs">
            Previous invoices, contracts, receipts, statements…
          </span>
        </button>
      ) : (
        <div className="space-y-3">
          {documents.map((draft) => {
            const kyc = isKycKind(draft.kind);
            return (
              <div
                key={draft.uid}
                className="bg-card grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-3">
                  <Label className="text-muted-foreground text-[10px] tracking-wide uppercase">
                    Type
                  </Label>
                  <Select
                    value={draft.kind}
                    onValueChange={(v) => patch(draft.uid, { kind: v as DocumentKind })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className={cn(showAmount ? 'sm:col-span-3' : 'sm:col-span-4')}>
                  <Label className="text-muted-foreground text-[10px] tracking-wide uppercase">
                    Reference / title
                  </Label>
                  <Input
                    className="mt-1.5"
                    placeholder={draft.kind === 'invoice' ? 'Invoice #' : 'Label'}
                    value={draft.title}
                    onChange={(e) => patch(draft.uid, { title: e.target.value })}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label className="text-muted-foreground text-[10px] tracking-wide uppercase">
                    Date
                  </Label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={draft.docDate}
                    onChange={(e) => patch(draft.uid, { docDate: e.target.value })}
                  />
                </div>

                {showAmount ? (
                  <div className="sm:col-span-2">
                    <Label className="text-muted-foreground text-[10px] tracking-wide uppercase">
                      Amount (₹)
                    </Label>
                    <Input
                      inputMode="decimal"
                      className="mt-1.5 font-mono"
                      placeholder="—"
                      value={draft.amount}
                      onChange={(e) => patch(draft.uid, { amount: e.target.value })}
                    />
                  </div>
                ) : null}

                <div className="flex items-end justify-end sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove document"
                    onClick={() => remove(draft.uid)}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </div>

                <div className="sm:col-span-12">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      type="file"
                      accept={ACCEPT}
                      className="max-w-xs"
                      onChange={(e) => patch(draft.uid, { file: e.target.files?.[0] ?? null })}
                    />
                    {draft.file ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <PaperclipIcon className="size-3" aria-hidden />
                        {draft.file.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">No file chosen</span>
                    )}
                    {kyc ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        <ShieldAlertIcon className="size-3" aria-hidden />
                        Restricted — filed to the KYC vault, view is audit-logged
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PaperclipIcon className="mr-1.5 size-3.5" aria-hidden />
            Add another document
          </Button>
        </div>
      )}
    </div>
  );
}
