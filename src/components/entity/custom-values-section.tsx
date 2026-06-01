'use client';

// Read-only Custom tab body. Reads the entity's custom values via the
// listCustomValues server action; the Form Builder's edit surface
// (form-designer.tsx) is a separate window — partner / admin only.
//
// Until form-template fetch lands, render a flat key/value list of
// whatever values exist. The Form Builder still owns the schema; this
// section just surfaces the stored JSONB.

import { useEffect, useState } from 'react';

import {
  listCustomValues,
  type CustomValueEntityType,
  type CustomValueRow,
} from '@/lib/server/entities/custom-values';

export type CustomValuesSectionProps = {
  entityType: CustomValueEntityType;
  entityId: string;
};

export function CustomValuesSection({ entityType, entityId }: CustomValuesSectionProps) {
  const [rows, setRows] = useState<readonly CustomValueRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCustomValues({ entityType, entityId })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load custom values');
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  if (err) {
    return <p style={{ color: 'var(--text-error, #c33)', fontSize: 13 }}>{err}</p>;
  }
  if (!rows) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading custom values…</p>;
  }
  if (rows.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        No custom values captured yet. Build a form template in the Form Designer to add custom
        fields for this entity.
      </p>
    );
  }

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        rowGap: 8,
        columnGap: 16,
        margin: 0,
        fontSize: 13,
      }}
    >
      {rows.map((r) => (
        <FieldRow key={r.id} fieldId={r.formFieldId} value={r.value} />
      ))}
    </dl>
  );
}

function FieldRow({ fieldId, value }: { fieldId: string; value: unknown }) {
  return (
    <>
      <dt
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-muted)',
        }}
      >
        {fieldId.slice(0, 8)}…
      </dt>
      <dd style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {renderValue(value)}
      </dd>
    </>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '—';
  }
}
