'use client';

import { useEffect, useState } from 'react';
import {
  BanknoteIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

export type BankAccount = {
  id: string;
  /** Bank display name, e.g. "HDFC Bank". */
  bankName: string;
  /** Masked number (e.g. "XXXX XXXX 1234"). The full number lives in the vault. */
  maskedNumber: string;
  /** IFSC is non-sensitive — store and display plain. */
  ifsc?: string | null;
  /** Account-holder name as printed on the cheque. */
  holderName?: string | null;
  /** "Savings" | "Current" | "OD" | "Cash Credit" — free-text. */
  accountType?: string | null;
  /** Set on the agency-side primary collection account. */
  isPrimary?: boolean;
  /** Branch name (free-text). */
  branch?: string | null;
  /** Set when soft-deleted. */
  deletedAt?: string | Date | null;
};

export type BankAccountListProps = {
  accounts: readonly BankAccount[];
  entityName?: string;
  /**
   * Per CLAUDE rule 27 + spec amendment, every reveal is audit-logged. The
   * "Reveal" button only renders when `canReveal` is true (server-validated
   * capability). Set to false in OS read-only contexts.
   */
  canReveal?: boolean;
  /**
   * Called when the user confirms a reveal. Implementation should return a
   * short-TTL signed URL (default 60s) which the consumer opens in a new tab.
   * The component itself never touches Supabase.
   */
  onReveal?: (accountId: string) => Promise<{ url: string; expiresAt: string }>;
  onAdd?: () => void;
  onEdit?: (account: BankAccount) => void;
  onDelete?: (account: BankAccount) => void;
  className?: string;
};

/**
 * Renders bank accounts with **masked numbers only**. Full numbers live in the
 * encrypted vault and may only be retrieved through a server-side reveal action
 * that logs every access (DPDP / CLAUDE rule 27, audit §5.4).
 *
 * Reveal flow: button → AlertDialog ("You're being audit-logged for this
 * access") → onReveal → consumer opens returned URL in a new tab.
 */
export function BankAccountList({
  accounts,
  entityName,
  canReveal,
  onReveal,
  onAdd,
  onEdit,
  onDelete,
  className,
}: BankAccountListProps) {
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={BanknoteIcon}
        title="No bank accounts on file"
        description={`Capture${entityName ? ` ${entityName}'s` : ''} bank details so payments can be wired and reconciled.`}
        action={
          <Button size="sm" onClick={onAdd} disabled={!onAdd}>
            Add bank account
          </Button>
        }
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Bank accounts</CardTitle>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={!onAdd}>
          <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
          Add bank account
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {accounts.map((account) => (
          <BankAccountCard
            key={account.id}
            account={account}
            canReveal={canReveal}
            onReveal={onReveal}
            onEdit={onEdit ? () => onEdit(account) : undefined}
            onDelete={onDelete ? () => onDelete(account) : undefined}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BankAccountCard({
  account,
  canReveal,
  onReveal,
  onEdit,
  onDelete,
}: {
  account: BankAccount;
  canReveal?: boolean;
  onReveal?: (accountId: string) => Promise<{ url: string; expiresAt: string }>;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revealedNumber, setRevealedNumber] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canShowReveal = Boolean(canReveal && onReveal);

  async function handleConfirmReveal() {
    if (!onReveal) return;
    setRevealing(true);
    setError(null);
    try {
      const { url } = await onReveal(account.id);
      window.open(url, '_blank', 'noopener,noreferrer');
      setRevealedNumber('opened');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reveal failed');
    } finally {
      setRevealing(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-md border p-3', account.deletedAt && 'opacity-50')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{account.bankName}</span>
            {account.isPrimary ? <StatusBadge tone="success" label="Primary" dot={false} /> : null}
            {account.accountType ? (
              <span className="text-muted-foreground text-xs">· {account.accountType}</span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-sm tabular-nums">{account.maskedNumber}</p>
          <dl className="text-muted-foreground mt-1 space-y-0.5 text-xs">
            {account.holderName ? <div>Holder: {account.holderName}</div> : null}
            {account.ifsc ? (
              <div>
                IFSC <span className="font-mono">{account.ifsc}</span>
              </div>
            ) : null}
            {account.branch ? <div>Branch: {account.branch}</div> : null}
          </dl>
          {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
          {revealedNumber === 'opened' ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Opened in a new tab. The link expires in 60 seconds — your access has been logged.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canShowReveal ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setConfirmOpen(true)}
              disabled={revealing}
              aria-label="Reveal full bank number"
            >
              {revealing ? (
                <LoaderIcon className="size-3.5 animate-spin" aria-hidden />
              ) : revealedNumber === 'opened' ? (
                <EyeOffIcon className="size-3.5" aria-hidden />
              ) : (
                <EyeIcon className="size-3.5" aria-hidden />
              )}
              Reveal
            </Button>
          ) : null}
          {onEdit ? (
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit bank account">
              <PencilIcon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Remove bank account">
              <Trash2Icon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {confirmOpen ? (
        <BankRevealModal
          revealing={revealing}
          onCancel={() => {
            if (!revealing) setConfirmOpen(false);
          }}
          onConfirm={() => void handleConfirmReveal()}
        />
      ) : null}
    </div>
  );
}

/**
 * OS-themed reveal-confirm modal for the bank-account flow. Same
 * audit-log copy as the shadcn AlertDialog it replaces.
 */
function BankRevealModal({
  revealing,
  onCancel,
  onConfirm,
}: {
  revealing: boolean;
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
            Reveal bank account?
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
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            You&apos;re being audit-logged for this access. The full account number will open in a
            new tab and the link expires in 60 seconds.
          </p>
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
          <button type="button" className="btn primary" onClick={onConfirm} disabled={revealing}>
            {revealing ? 'Opening…' : 'Reveal'}
          </button>
        </div>
      </div>
    </div>
  );
}
