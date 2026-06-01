'use client';

import { useEffect, useState } from 'react';
import {
  EyeIcon,
  FileBadgeIcon,
  LoaderIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';

/**
 * Categories per AUDIT-GAPS §3.2 + India compliance docs.
 *   - PAN: 10-char tax ID; bottom-half masked everywhere except review.
 *   - GSTIN: 15-char state-prefixed; full string allowed in display (not PII).
 *   - TAN: tax-deduction-account number (10 chars).
 *   - MSME / UDYAM: registration for micro/small/medium enterprises (12 chars).
 *   - AADHAAR: 12-digit ID, **restricted-kyc bucket only**; always masked.
 *   - Other: free-form (e.g. IEC, FSSAI, RERA).
 */
export type TaxIdentifierKind = 'pan' | 'gstin' | 'tan' | 'msme' | 'aadhaar' | 'other';

export type TaxIdentifier = {
  id: string;
  kind: TaxIdentifierKind;
  /**
   * Display-safe value. For PAN and Aadhaar this is the masked form
   * (`XXXXXX1234X`). For GSTIN it's the full 15-char string.
   */
  maskedValue: string;
  /** Optional free-text label (e.g. "Maharashtra GSTIN"). */
  label?: string | null;
  /**
   * Whether the kind stores a fully-revealable secret in the vault. PAN and
   * Aadhaar do; GSTIN doesn't (the full string IS the masked value).
   */
  revealable?: boolean;
  /** Set when soft-deleted. */
  deletedAt?: string | Date | null;
};

const KIND_LABELS: Record<TaxIdentifierKind, string> = {
  pan: 'PAN',
  gstin: 'GSTIN',
  tan: 'TAN',
  msme: 'MSME / Udyam',
  aadhaar: 'Aadhaar',
  other: 'Other',
};

export type TaxIdentifierListProps = {
  identifiers: readonly TaxIdentifier[];
  entityName?: string;
  /**
   * Capability gate. When false (or when `onReveal` is missing), the reveal
   * button is hidden even for revealable kinds.
   */
  canReveal?: boolean;
  onReveal?: (identifierId: string) => Promise<{ url: string; expiresAt: string }>;
  onAdd?: () => void;
  onDelete?: (identifier: TaxIdentifier) => void;
  className?: string;
};

export function TaxIdentifierList({
  identifiers,
  entityName,
  canReveal,
  onReveal,
  onAdd,
  onDelete,
  className,
}: TaxIdentifierListProps) {
  const [revealTarget, setRevealTarget] = useState<TaxIdentifier | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirmReveal() {
    if (!onReveal || !revealTarget) return;
    setRevealing(true);
    setError(null);
    try {
      const { url } = await onReveal(revealTarget.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed');
    } finally {
      setRevealing(false);
      setRevealTarget(null);
    }
  }

  if (identifiers.length === 0) {
    return (
      <EmptyState
        icon={FileBadgeIcon}
        title="No tax identifiers on file"
        description={`Capture${entityName ? ` ${entityName}'s` : ''} PAN, GSTIN, TAN or other registrations to enable correct GST treatment on invoices.`}
        action={
          <Button size="sm" onClick={onAdd} disabled={!onAdd}>
            Add identifier
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Tax identifiers</CardTitle>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={!onAdd}>
            <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
            Add identifier
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Kind</TableHead>
                <TableHead className="px-4">Value</TableHead>
                <TableHead className="px-4">Label</TableHead>
                <TableHead className="px-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identifiers.map((identifier) => {
                const showReveal = Boolean(canReveal && onReveal && identifier.revealable);
                return (
                  <TableRow
                    key={identifier.id}
                    className={cn(identifier.deletedAt && 'opacity-50')}
                  >
                    <TableCell className="px-4 font-medium">
                      {KIND_LABELS[identifier.kind]}
                    </TableCell>
                    <TableCell className="px-4 font-mono text-sm tabular-nums">
                      {identifier.maskedValue}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4">
                      {identifier.label ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {showReveal ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setRevealTarget(identifier)}
                            aria-label="Reveal full identifier"
                          >
                            <EyeIcon className="size-3.5" aria-hidden />
                            Reveal
                          </Button>
                        ) : null}
                        {onDelete ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(identifier)}
                            aria-label="Remove identifier"
                          >
                            <Trash2Icon className="size-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {revealTarget !== null ? (
        <RevealConfirmModal
          title={`Reveal ${KIND_LABELS[revealTarget.kind]}?`}
          revealing={revealing}
          error={error}
          onCancel={() => {
            if (!revealing) {
              setRevealTarget(null);
              setError(null);
            }
          }}
          onConfirm={() => void handleConfirmReveal()}
        />
      ) : null}
    </>
  );
}

/**
 * OS-themed reveal-confirm modal. Same audit-log copy as the shadcn
 * AlertDialog it replaces, rendered via the OS modal chrome so it lines
 * up with the rest of the OS surface (Rule 47 + matching CSS variables).
 */
function RevealConfirmModal({
  title,
  revealing,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  revealing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !revealing) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealing, onCancel]);

  return (
    <div
      className="os-modal-overlay"
      onMouseDown={() => {
        if (!revealing) onCancel();
      }}
    >
      <div className="os-modal" style={{ width: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div
            className="font-display"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17 }}
          >
            <ShieldAlertIcon
              style={{ width: 16, height: 16, color: 'var(--apar-amber, #d08a1e)' }}
              aria-hidden
            />
            {title}
          </div>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={revealing}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            You&apos;re being audit-logged for this access. The full value will open in a new tab
            and the link expires in 60 seconds.
          </p>
          {error ? (
            <p style={{ fontSize: 12, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>
          ) : null}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 16px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button type="button" className="btn" onClick={onCancel} disabled={revealing}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={revealing}
          >
            {revealing ? (
              <>
                <LoaderIcon
                  style={{
                    width: 14,
                    height: 14,
                    marginRight: 6,
                    animation: 'spin 0.8s linear infinite',
                  }}
                  aria-hidden
                />
                Opening…
              </>
            ) : (
              'Reveal'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
