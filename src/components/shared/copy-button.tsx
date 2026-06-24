'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Monotonic token shared by all CopyButtons: a pending auto-clear is skipped
// when a newer in-app copy has superseded it (external copies can't be
// detected without a clipboard-read permission prompt — accepted limitation).
let lastCopyToken = 0;

/**
 * Copy-to-clipboard button. Used across Settings → Company details / Billing
 * so any captured value (GSTIN, PAN, TAN, Udyam, account number, IFSC, …) can
 * be lifted in one click — the "direct copy paste" requirement.
 *
 * `clearAfterMs` (opt-in, for secrets like vault passwords) best-effort
 * clears the clipboard after the given delay.
 */
export function CopyButton({
  value,
  label,
  className,
  size = 'icon',
  clearAfterMs,
}: {
  value: string;
  /** Accessible label; defaults to "Copy". When set, shown as a text button. */
  label?: string;
  className?: string;
  size?: 'icon' | 'sm';
  /** Clear the clipboard this many ms after copying (secrets only). */
  clearAfterMs?: number;
}) {
  const [copied, setCopied] = useState(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts where the Clipboard API is blocked.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    if (clearAfterMs) {
      const token = ++lastCopyToken;
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => {
        // Skip when a newer in-app copy owns the clipboard now.
        if (token === lastCopyToken) {
          navigator.clipboard.writeText('').catch(() => {});
        }
      }, clearAfterMs);
    } else if (clearAfterMs === undefined) {
      // Plain copies still bump the token so they cancel pending clears.
      lastCopyToken++;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size={size === 'icon' ? 'icon' : 'sm'}
      onClick={copy}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      title={label ? `Copy ${label}` : 'Copy'}
      className={cn(size === 'icon' && 'size-7', copied && 'text-emerald-600', className)}
    >
      <Icon className={cn(size === 'icon' ? 'size-3.5' : 'mr-1 size-3.5')} aria-hidden />
      {size === 'sm' ? (copied ? 'Copied' : 'Copy') : null}
    </Button>
  );
}
