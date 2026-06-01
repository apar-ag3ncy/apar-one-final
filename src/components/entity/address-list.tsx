'use client';

import { MapPinIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

export type Address = {
  id: string;
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  /**
   * GSTIN registered for this address (amendment §3 — entities may have
   * different GSTINs per state of operation). Captured, never validated against
   * the line items — that's audit territory.
   */
  gstin?: string | null;
  isPrimary?: boolean;
  /** "billing" | "shipping" | "registered" | etc. — free-text. */
  kind?: string | null;
  deletedAt?: string | Date | null;
};

export type AddressListProps = {
  addresses: readonly Address[];
  entityName?: string;
  onAdd?: () => void;
  onEdit?: (address: Address) => void;
  onDelete?: (address: Address) => void;
  className?: string;
};

export function AddressList({
  addresses,
  entityName,
  onAdd,
  onEdit,
  onDelete,
  className,
}: AddressListProps) {
  if (addresses.length === 0) {
    return (
      <EmptyState
        icon={MapPinIcon}
        title="No addresses on file"
        description={`Capture a registered address${
          entityName ? ` for ${entityName}` : ''
        } to enable invoicing and intra/inter-state classification.`}
        action={
          <Button size="sm" onClick={onAdd} disabled={!onAdd}>
            Add address
          </Button>
        }
      />
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Addresses</CardTitle>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={!onAdd}>
          <PlusIcon className="mr-1.5 size-3.5" aria-hidden />
          Add address
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {addresses.map((address) => (
          <AddressCard
            key={address.id}
            address={address}
            onEdit={onEdit ? () => onEdit(address) : undefined}
            onDelete={onDelete ? () => onDelete(address) : undefined}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function AddressCard({
  address,
  onEdit,
  onDelete,
}: {
  address: Address;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-md border p-3', address.deletedAt && 'opacity-50')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">
              {address.label ?? address.kind ?? 'Address'}
            </span>
            {address.isPrimary ? <StatusBadge tone="success" label="Primary" dot={false} /> : null}
          </div>
          <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">
            {address.line1}
            {address.line2 ? `\n${address.line2}` : ''}
            {`\n${address.city}, ${address.state} ${address.postalCode}`}
            {address.country ? `\n${address.country}` : ''}
          </p>
          {address.gstin ? (
            <p className="text-muted-foreground mt-1 font-mono text-xs">GSTIN {address.gstin}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onEdit ? (
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit address">
              <PencilIcon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label="Remove address">
              <Trash2Icon className="size-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
