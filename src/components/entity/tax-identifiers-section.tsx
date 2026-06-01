'use client';

// Smart wrapper around <TaxIdentifierList /> — fetches via
// listTaxIdentifiers and wires the audit-logged reveal flow through
// revealIdentifier (server-stub/entity-actions → lib/storage.ts:revealKyc,
// 60s signed URL, audit + activity log).
//
// `canReveal` flips on the current user's `reveal_kyc` capability —
// hidden entirely when missing.

import { useEffect, useState } from 'react';

import {
  TaxIdentifierList,
  type TaxIdentifier,
  type TaxIdentifierKind,
} from './tax-identifier-list';
import {
  listTaxIdentifiers,
  type TaxIdentifierEntityType,
  type TaxIdentifierKindDb,
  type TaxIdentifierRow,
} from '@/lib/server/entities/tax-identifiers';
import { revealIdentifier as revealIdentifierAction } from '@/lib/server-stub/entity-actions';
import { useCurrentUser } from '@/lib/client/use-current-user';

const KIND_MAP: Record<TaxIdentifierKindDb, TaxIdentifierKind> = {
  pan: 'pan',
  gstin: 'gstin',
  tan: 'tan',
  msme_udyam: 'msme',
  lut: 'other',
  aadhaar: 'aadhaar',
};

function rowToView(r: TaxIdentifierRow): TaxIdentifier {
  return {
    id: r.id,
    kind: KIND_MAP[r.kind],
    maskedValue: r.maskedValue,
    revealable: !!r.vaultObjectKey,
  };
}

export type TaxIdentifiersSectionProps = {
  entityType: TaxIdentifierEntityType;
  entityId: string;
  entityName?: string;
};

export function TaxIdentifiersSection({
  entityType,
  entityId,
  entityName,
}: TaxIdentifiersSectionProps) {
  const { hasCapability } = useCurrentUser();
  const [rows, setRows] = useState<readonly TaxIdentifierRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTaxIdentifiers({ entityType, entityId })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load tax identifiers');
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
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
        Loading tax identifiers…
      </p>
    );
  }

  return (
    <TaxIdentifierList
      identifiers={rows.map(rowToView)}
      entityName={entityName}
      canReveal={hasCapability('reveal_kyc')}
      onReveal={(identifierId) => revealIdentifierAction(identifierId)}
    />
  );
}
