'use client';

import { InfoIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import type { ReferenceRate } from './types';

export type ReferenceRatePillProps = {
  /**
   * The reference row this pill shows. `null` means "no reference seeded for
   * this SAC / section yet" — pill renders a muted variant that still hints to
   * the user that captured values won't be checked.
   */
  rate: ReferenceRate | null;
  /**
   * What the user has captured, in bps (1800 = 18%). When mismatched against
   * `rate.rate_bps`, the pill switches to a "warn" tone so the user sees the
   * discrepancy — but the captured value is what posts (CLAUDE rule #2,
   * agent prompt: captured-not-computed).
   */
  capturedBps?: number;
  /** Optional label override; defaults to "Reference rate". */
  label?: string;
  className?: string;
};

/**
 * Small inline pill that surfaces a tax_reference_rates row alongside a
 * user-entered tax field. Informational only — never overrides the captured
 * value. Click to open a popover with the full reference row.
 *
 * Used by InvoiceForm, EstimateForm, BillForm, CreditNoteForm — every place
 * the user enters a GST / TDS amount.
 */
export function ReferenceRatePill({
  rate,
  capturedBps,
  label = 'Reference rate',
  className,
}: ReferenceRatePillProps) {
  // No seeded reference → muted hint, click does nothing useful.
  if (rate === null) {
    return (
      <span
        className={cn(
          'bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
          className,
        )}
        aria-label="No reference rate seeded"
      >
        <InfoIcon className="size-3" aria-hidden />
        No reference
      </span>
    );
  }

  const mismatch = typeof capturedBps === 'number' && capturedBps !== rate.rate_bps;
  const tone = mismatch
    ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200'
    : 'bg-sky-100 text-sky-900 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-200';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'focus-visible:ring-ring inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
            tone,
            className,
          )}
          aria-label={`${label}: ${formatBps(rate.rate_bps)} for ${rate.code}`}
        >
          <InfoIcon className="size-3" aria-hidden />
          {label}: {formatBps(rate.rate_bps)} for {rate.code}
          {mismatch ? (
            <span aria-hidden className="ml-0.5 font-semibold">
              ≠ {formatBps(capturedBps!)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" side="top">
        <div className="space-y-2">
          <div className="font-medium">{rate.description}</div>
          <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt>Code</dt>
            <dd className="text-foreground font-mono">{rate.code}</dd>
            {rate.sac_code ? (
              <>
                <dt>SAC</dt>
                <dd className="text-foreground font-mono">{rate.sac_code}</dd>
              </>
            ) : null}
            {rate.statutory_section ? (
              <>
                <dt>Section</dt>
                <dd className="text-foreground">{rate.statutory_section}</dd>
              </>
            ) : null}
            <dt>Rate</dt>
            <dd className="text-foreground font-mono">{formatBps(rate.rate_bps)}</dd>
            <dt>Effective</dt>
            <dd className="text-foreground">
              {rate.effective_from}
              {rate.effective_to ? ` → ${rate.effective_to}` : ' → present'}
            </dd>
          </dl>
          {mismatch ? (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              You captured {formatBps(capturedBps!)} — different from the reference. Apar will save
              your captured value; the reference is shown for awareness only.
            </p>
          ) : null}
          {/* Future: link to settings page to edit this reference row. */}
          <div className="pt-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
              View in settings
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "1800" → "18%". "1825" → "18.25%". "1830" → "18.3%".
 *
 * Avoids `Number.prototype.toFixed` (which the repo's check:money gate flags
 * as a precision risk for money rendering). bps are integers, so we can
 * stringify the quotient + remainder directly.
 */
function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const remainder = Math.abs(bps % 100);
  if (remainder === 0) return `${whole}%`;
  const padded = remainder.toString().padStart(2, '0');
  // Strip a trailing zero so "1830" renders "18.3%", not "18.30%".
  const fractional = padded.endsWith('0') ? padded.slice(0, 1) : padded;
  return `${whole}.${fractional}%`;
}
