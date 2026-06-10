'use client';

// Smart wrapper around <AddressList /> — fetches via the addresses.ts
// server actions and owns the add/edit dialog, the set-primary affordance,
// and the delete confirmation. Mirrors ContactsSection so Client / Vendor /
// Employee windows can drop it in by entity-type alone.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddressList, type Address } from './address-list';
import { AddressForm, type AddressFormValues } from './address-form';
import {
  createAddress,
  listAddresses,
  softDeleteAddress,
  updateAddress,
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
  const [, startTransition] = useTransition();

  // Add / edit dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AddressRow | null>(null);

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<AddressRow | null>(null);

  // Stable identity for the form's initial values so AddressForm's reset effect
  // (keyed on `initial`) only fires when the edited row actually changes — not
  // on every section re-render, which could otherwise wipe in-progress edits.
  const initialForForm = useMemo(
    () =>
      editing
        ? {
            kind: editing.kind,
            line1: editing.line1,
            line2: editing.line2,
            city: editing.city,
            stateCode: editing.stateCode,
            postalCode: editing.postalCode,
            country: editing.country,
            gstin: editing.gstin,
            isPrimary: editing.isPrimary,
            notes: editing.notes,
          }
        : undefined,
    [editing],
  );

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

  async function handleSubmit(values: AddressFormValues) {
    if (editing) {
      const updated = await updateAddress(editing.id, {
        kind: values.kind,
        line1: values.line1,
        line2: values.line2 || null,
        city: values.city,
        stateCode: values.stateCode,
        postalCode: values.postalCode || null,
        country: values.country,
        gstin: values.gstin || null,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setRows((prev) => {
          if (!prev) return prev;
          const next = prev.map((r) => (r.id === updated.id ? updated : r));
          if (updated.isPrimary) {
            return next.map((r) => (r.id === updated.id ? r : { ...r, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Address updated.');
    } else {
      const created = await createAddress({
        entityType,
        entityId,
        kind: values.kind,
        line1: values.line1,
        line2: values.line2 || null,
        city: values.city,
        stateCode: values.stateCode,
        postalCode: values.postalCode || null,
        country: values.country,
        gstin: values.gstin || null,
        isPrimary: values.isPrimary,
        notes: values.notes || null,
      });
      startTransition(() => {
        setRows((prev) => {
          const base = prev ?? [];
          const next = [...base, created];
          if (created.isPrimary) {
            return next.map((r) => (r.id === created.id ? r : { ...r, isPrimary: false }));
          }
          return next;
        });
      });
      toast.success('Address added.');
    }
    setEditing(null);
  }

  async function handleSetPrimary(r: AddressRow) {
    try {
      const updated = await updateAddress(r.id, { isPrimary: true });
      startTransition(() => {
        setRows((prev) => {
          if (!prev) return prev;
          return prev.map((row) =>
            row.id === updated.id ? updated : { ...row, isPrimary: false },
          );
        });
      });
      toast.success('Primary address updated.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not set primary address.';
      toast.error(msg);
    }
  }

  async function handleSoftDelete(r: AddressRow) {
    try {
      await softDeleteAddress(r.id);
      startTransition(() => {
        setRows((prev) => (prev ? prev.filter((row) => row.id !== r.id) : prev));
      });
      toast.success('Address removed.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not remove address.';
      toast.error(msg);
    } finally {
      setPendingDelete(null);
    }
  }

  if (err) {
    return <p style={{ color: 'var(--text-error, #c33)', fontSize: 13, margin: 0 }}>{err}</p>;
  }
  if (!rows) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading addresses…</p>
    );
  }

  return (
    <>
      <AddressList
        addresses={rows.map(rowToView)}
        entityName={entityName}
        onAdd={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(a) => {
          const row = rows.find((x) => x.id === a.id);
          if (!row) return;
          setEditing(row);
          setFormOpen(true);
        }}
        onSetPrimary={(a) => {
          const row = rows.find((x) => x.id === a.id);
          if (!row || row.isPrimary) return;
          void handleSetPrimary(row);
        }}
        onDelete={(a) => {
          const row = rows.find((x) => x.id === a.id);
          if (!row) return;
          setPendingDelete(row);
        }}
      />

      <AddressForm
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditing(null);
        }}
        mode={editing ? 'edit' : 'create'}
        initial={initialForForm}
        entityName={entityName}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(v) => {
          if (!v) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this address?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  <strong>{pendingDelete.line1}</strong>
                  {` · ${pendingDelete.city}, ${pendingDelete.stateCode}`}
                  <br />
                </>
              ) : null}
              Removing archives the address — it stays queryable but is hidden from this list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && handleSoftDelete(pendingDelete)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
