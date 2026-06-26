'use client';

import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/shared/currency-input';
import { formatINR } from '@/components/shared/format-inr';
import { cn } from '@/lib/utils';

export type TransactionLineItem = {
  description: string;
  hsn: string;
  quantity: number;
  unitPricePaise: bigint;
  gstPct: number;
  /** Optional TDS section captured from the document. */
  tdsSection?: string;
};

export type TransactionLineItemsProps = {
  items: readonly TransactionLineItem[];
  onChange: (next: readonly TransactionLineItem[]) => void;
  /** Show GST per line. Default true. */
  showGst?: boolean;
  /** Show HSN/SAC code. Default true. */
  showHsn?: boolean;
  /** Show TDS section dropdown. Default false (vendor-bill only). */
  showTds?: boolean;
  className?: string;
};

const EMPTY_LINE: TransactionLineItem = {
  description: '',
  hsn: '',
  quantity: 1,
  unitPricePaise: 0n,
  gstPct: 18,
};

/**
 * Shared line-items grid used by vendor-bill and client-invoice forms.
 *
 * Per CLAUDE.md, we **never** compute tax: line gst/tds are captured from
 * the source document. The display totals here are recap-only — the server
 * is the source of truth on whether `Σ(line subtotals) + Σ(gst) + Σ(tds) ≡
 * stated total`, and a `gst_subtotal_mismatch` warn flag is raised if not.
 */
export function TransactionLineItems({
  items,
  onChange,
  showGst = true,
  showHsn = true,
  showTds = false,
  className,
}: TransactionLineItemsProps) {
  const subtotal = items.reduce(
    (s, l) => s + BigInt(Math.max(0, Math.floor(l.quantity))) * l.unitPricePaise,
    0n,
  );
  const totalGst = items.reduce(
    (s, l) =>
      s +
      (BigInt(Math.max(0, Math.floor(l.quantity))) *
        l.unitPricePaise *
        BigInt(Math.floor(l.gstPct * 100))) /
        10000n,
    0n,
  );

  function patch(idx: number, p: Partial<TransactionLineItem>) {
    const next = items.slice();
    next[idx] = { ...next[idx]!, ...p };
    onChange(next);
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="text-muted-foreground grid grid-cols-12 gap-2 px-2 text-[10px] tracking-wide uppercase">
        <div className={showTds ? 'col-span-3' : 'col-span-4'}>Description</div>
        {showHsn ? <div className="col-span-1">HSN</div> : null}
        <div className="col-span-1">Qty</div>
        <div className="col-span-2 text-right">Unit ₹</div>
        {showGst ? <div className="col-span-1 text-right">GST %</div> : null}
        {showTds ? <div className="col-span-1">TDS</div> : null}
        <div className="col-span-2 text-right">Subtotal</div>
        <div className="col-span-1" />
      </div>

      {items.map((line, idx) => {
        const lineSubtotal = BigInt(Math.max(0, Math.floor(line.quantity))) * line.unitPricePaise;
        return (
          <div key={idx} className="grid grid-cols-12 items-center gap-2 rounded-md border p-2">
            <Input
              className={showTds ? 'col-span-3' : 'col-span-4'}
              value={line.description}
              onChange={(e) => patch(idx, { description: e.target.value })}
              placeholder="Description"
            />
            {showHsn ? (
              <Input
                className="col-span-1 font-mono"
                value={line.hsn}
                onChange={(e) => patch(idx, { hsn: e.target.value })}
                placeholder="HSN"
              />
            ) : null}
            <Input
              className="col-span-1 text-right tabular-nums"
              type="number"
              min={0}
              value={line.quantity}
              onChange={(e) => patch(idx, { quantity: Number(e.target.value) || 0 })}
            />
            <div className="col-span-2">
              <CurrencyInput
                value={line.unitPricePaise}
                onValueChange={(p) => patch(idx, { unitPricePaise: p ?? 0n })}
              />
            </div>
            {showGst ? (
              <Input
                className="col-span-1 text-right tabular-nums"
                type="number"
                min={0}
                step={0.01}
                value={line.gstPct}
                onChange={(e) => patch(idx, { gstPct: Number(e.target.value) || 0 })}
              />
            ) : null}
            {showTds ? (
              <Input
                className="col-span-1 font-mono"
                value={line.tdsSection ?? ''}
                onChange={(e) => patch(idx, { tdsSection: e.target.value })}
                placeholder="194C"
              />
            ) : null}
            <div className="text-muted-foreground col-span-2 text-right font-mono text-sm tabular-nums">
              {formatINR(lineSubtotal)}
            </div>
            <div className="col-span-1 text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                aria-label="Remove line"
                disabled={items.length === 1}
              >
                <Trash2Icon className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { ...EMPTY_LINE }])}
      >
        <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
        Add line
      </Button>

      <div className="ml-auto flex max-w-md flex-col gap-1 border-t pt-3 text-sm">
        <Recap label="Subtotal" value={formatINR(subtotal)} />
        {showGst ? <Recap label="GST (captured)" value={formatINR(totalGst)} /> : null}
        <Recap label="Captured total" value={formatINR(subtotal + totalGst)} strong />
        <p className="text-muted-foreground mt-1 text-xs">
          Numbers are captured from the document — never computed by Apar. The server flags a
          mismatch if Σ(lines) + GST + TDS doesn&apos;t equal the document&apos;s stated total.
        </p>
      </div>
    </div>
  );
}

function Recap({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className={strong ? 'text-foreground font-medium' : 'text-muted-foreground'}>
        {label}
      </Label>
      <span className={cn('font-mono tabular-nums', strong && 'text-base font-semibold')}>
        {value}
      </span>
    </div>
  );
}
