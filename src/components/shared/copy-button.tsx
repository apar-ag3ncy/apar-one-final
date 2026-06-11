'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Copy-to-clipboard button. Used across Settings → Company details / Billing
 * so any captured value (GSTIN, PAN, TAN, Udyam, account number, IFSC, …) can
 * be lifted in one click — the "direct copy paste" requirement.
 */
export function CopyButton({
  value,
  label,
  className,
  size = 'icon',
}: {
  value: string;
  /** Accessible label; defaults to "Copy". When set, shown as a text button. */
  label?: string;
  className?: string;
  size?: 'icon' | 'sm';
}) {
  const [copied, setCopied] = useState(false);

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
