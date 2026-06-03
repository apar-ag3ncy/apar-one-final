'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheckIcon, PlusIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react';
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
import { StatusBadge } from '@/components/shared/status-badge';
import { CurrencyInput } from '@/components/shared/currency-input';
import { formatINR } from '@/components/shared/format-inr';
import {
  createDraftTransactionTyped,
  getChartOfAccounts,
  postTransaction,
} from '@/lib/server-stub/ledger-actions';
import type { ChartAccount } from '@/lib/server-stub/ledger-types';
import type { TransactionFlag } from '@/components/entity/transaction-detail';
import { ValidationFlags } from '@/components/entity/validation-flags';

type Line = {
  accountCode: string;
  description: string;
  debit: bigint;
  credit: bigint;
};

const EMPTY_LINE: Line = { accountCode: '', description: '', debit: 0n, credit: 0n };

export function JournalVoucherForm() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<readonly ChartAccount[]>([]);
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<{ id: string; flags: readonly TransactionFlag[] } | null>(
    null,
  );
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [postMessage, setPostMessage] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);

  useEffect(() => {
    void getChartOfAccounts().then(setAccounts);
  }, []);

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0n);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0n);
  const balanced = totalDebit === totalCredit && totalDebit > 0n;

  const canCreateDraft = balanced && reason.trim().length >= 10 && !pending;
  const blockFlags = draft?.flags.filter((f) => f.severity === 'block') ?? [];
  const warnFlags = draft?.flags.filter((f) => f.severity === 'warn') ?? [];
  const allWarnsAcked = warnFlags.every((f) => acked.has(f.id));
  const canPost = draft !== null && blockFlags.length === 0 && allWarnsAcked && !pending;

  function patchLine(idx: number, p: Partial<Line>) {
    const next = lines.slice();
    next[idx] = { ...next[idx]!, ...p };
    setLines(next);
  }

  function handleCreateDraft() {
    setDraft(null);
    setAcked(new Set());
    setPostMessage(null);
    startTransition(async () => {
      try {
        // Generate an externalRef from the date — JV-YYYY-MM-DD-XXXX —
        // which the `external_ref_clash` validation will block if a
        // duplicate already exists for that day.
        const externalRef = `JV-${date}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const result = await createDraftTransactionTyped({
          kind: 'journal',
          input: {
            externalRef,
            txnDate: date,
            journalReason: reason,
            legs: lines
              .filter((l) => l.accountCode && (l.debit > 0n || l.credit > 0n))
              .map((l) => ({
                accountCode: l.accountCode,
                side: l.debit > 0n ? ('debit' as const) : ('credit' as const),
                amountPaise: l.debit > 0n ? l.debit : l.credit,
              })),
            isOpeningBalance: false,
            notes: null,
          },
        });
        setDraft({ id: result.transactionId, flags: result.flags });
      } catch (e) {
        setPostMessage(e instanceof Error ? e.message : 'Could not create draft.');
      }
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
      if (result.ok) setPostedId(result.transactionId);
      else setPostMessage(result.message);
    });
  }

  if (postedId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CircleCheckIcon className="size-10 text-emerald-500" aria-hidden />
          <h2 className="text-lg font-semibold">Journal voucher posted</h2>
          <p className="text-muted-foreground text-sm">
            Transaction id <span className="font-mono">{postedId}</span>.
          </p>
          <Button variant="outline" onClick={() => router.push('/ledger')}>
            Back to ledger
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30">
        <CardContent className="flex items-start gap-2 py-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <p>
            Journal vouchers bypass typed-transaction validations and write directly to the GL.
            Every JV is partner-only and audit-logged with the reason below. Use a typed transaction
            kind whenever possible.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-muted-foreground text-xs tracking-wide uppercase">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-muted-foreground text-xs tracking-wide uppercase">
                Reason (mandatory, min 10 characters)
              </Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Year-end reclassification: move FY25 misposted ₹X from 6500 Travel to 5100 Direct project cost for client cl_001."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Postings</CardTitle>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-mono tabular-nums">Dr {formatINR(totalDebit)}</span>
            <span className="font-mono tabular-nums">Cr {formatINR(totalCredit)}</span>
            {balanced ? (
              <StatusBadge tone="success" label="Balanced" dot={false} />
            ) : (
              <StatusBadge tone="danger" label="Unbalanced" dot={false} />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-12 items-center gap-2 rounded-md border p-2">
              <div className="col-span-4">
                <Select
                  value={line.accountCode}
                  onValueChange={(v) => patchLine(idx, { accountCode: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.code} value={a.code}>
                        <span className="font-mono">{a.code}</span> — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="col-span-3"
                placeholder="Memo"
                value={line.description}
                onChange={(e) => patchLine(idx, { description: e.target.value })}
              />
              <div className="col-span-2">
                <CurrencyInput
                  value={line.debit}
                  onValueChange={(p) =>
                    patchLine(idx, { debit: p ?? 0n, credit: p && p > 0n ? 0n : line.credit })
                  }
                />
              </div>
              <div className="col-span-2">
                <CurrencyInput
                  value={line.credit}
                  onValueChange={(p) =>
                    patchLine(idx, { credit: p ?? 0n, debit: p && p > 0n ? 0n : line.debit })
                  }
                />
              </div>
              <div className="col-span-1 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                  disabled={lines.length <= 2}
                  aria-label="Remove line"
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines([...lines, { ...EMPTY_LINE }])}
          >
            <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
            Add posting
          </Button>
        </CardContent>
      </Card>

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

      <div className="flex items-center justify-end gap-2">
        {draft === null ? (
          <Button onClick={handleCreateDraft} disabled={!canCreateDraft}>
            {pending ? 'Creating draft…' : 'Create draft & validate'}
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={pending}>
              Edit
            </Button>
            <Button onClick={handlePost} disabled={!canPost}>
              {pending ? 'Posting…' : 'Post JV'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
