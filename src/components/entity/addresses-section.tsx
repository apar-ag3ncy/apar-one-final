'use client';

// Smart wrapper around <AddressList /> — fetches via the addresses.ts
// server actions and renders a primary-aware empty-state CTA. Mirrors
// ContactsSection / DocumentsSection so Client / Vendor / Employee
// windows can drop it in by entity-type alone.

import { useEffect, useState } from 'react';

import { AddressList, type Address } from './address-list';
import {
  listAddresses,
  type AddressEntityType,
  type AddressRow,
} from '@/lib/server/entities/addresses';

function rowToView(r: AddressRow): Address {
  return {
    id: r.id,
    label: r.kind,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    state: r.stateCode,
    postalCode: r.postalCode ?? '',
    country: r.country,
    gstin: r.gstin,
    isPrimary: r.isPrimary,
    kind: r.kind,
  };
}

export type AddressesSectionProps = {
  entityType: AddressEntityType;
  entityId: string;
  entityName?: string;
};

export function AddressesSection({ entityType, entityId, entityName }: AddressesSectionProps) {
  const [rows, setRows] = useState<readonly AddressRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAddresses({ entityType, entityId })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load addresses');
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (err) {
    return <p style={{ color: 'var(--text-error, #c33)', fontSize: 13, margin: 0 }}>{err}</p>;
  }
  if (!rows) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading addresses…</p>
    );
  }

  return (
    <AddressList
      addresses={rows.map(rowToView)}
      entityName={entityName}
      // Create / edit / delete are wired by the parent window via dialogs once
      // the address form ships. For now the list is read-only; the empty state
      // surfaces the call-to-action.
    />
  );
}
