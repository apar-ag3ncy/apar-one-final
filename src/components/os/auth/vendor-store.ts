'use client';

// Per-user vendor data: vendors, invoices, documents.
//
// Stored as a single JSON blob under `apar-os:vendors:${uid}`. Seed vendors
// from `data.ts` are read-only by default; user edits on a seed vendor are
// recorded as a Partial<Vendor> overlay, and user deletions are tombstones.
// User-added vendors live in `added` and are mutated in place.

import { useCallback, useMemo, useState } from 'react';
import { VENDORS as SEED_VENDORS } from '../data';
import { parseState, stringifyState } from '../serialize';
import type { Paise, Vendor, VendorDocument, VendorInvoice } from '../types';

type VendorBlob = {
  added: Vendor[];
  edits: Record<string, Partial<Vendor>>;
  removed: string[];
  invoices: VendorInvoice[];
  documents: VendorDocument[];
};

const EMPTY: VendorBlob = {
  added: [],
  edits: {},
  removed: [],
  invoices: [],
  documents: [],
};

// v2 = money fields (Vendor.outstanding, VendorInvoice.{subtotal,gst,tds,total})
// are bigint paise per CLAUDE rule #1 + LEDGER-SPEC §8.1. Old v1 blobs under
// `apar-os:vendors:${uid}` are discarded silently; seed re-populates first read.
function key(userId: string) {
  return `apar-os:vendors:${userId}:v2`;
}

function read(userId: string): VendorBlob {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return EMPTY;
    const parsed = parseState<
      Partial<VendorBlob> & {
        // Legacy field from earlier version — promoted to `added`.
        vendors?: Vendor[];
      }
    >(raw);
    return {
      added: Array.isArray(parsed.added)
        ? parsed.added
        : Array.isArray(parsed.vendors)
          ? parsed.vendors
          : [],
      edits: parsed.edits && typeof parsed.edits === 'object' ? parsed.edits : {},
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(userId: string, value: VendorBlob) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(userId), stringifyState(value));
  } catch {
    // ignore quota / private-mode failures
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type VendorInput = Omit<Vendor, 'id' | 'createdAt' | 'outstanding' | 'last'> & {
  outstanding?: Paise;
  last?: string;
};

export type InvoiceInput = Omit<VendorInvoice, 'id' | 'createdAt'>;
export type DocumentInput = Omit<VendorDocument, 'id' | 'uploadedAt'>;

export function useVendorStore(userId: string) {
  const [blob, setBlob] = useState<VendorBlob>(() => read(userId));

  const persist = useCallback(
    (next: VendorBlob) => {
      write(userId, next);
      setBlob(next);
    },
    [userId],
  );

  // Merged list: user-added first, then seed entries (minus tombstones,
  // with edits applied).
  const vendors = useMemo<readonly Vendor[]>(() => {
    const removed = new Set(blob.removed);
    const merged: Vendor[] = [...blob.added];
    for (const s of SEED_VENDORS) {
      if (removed.has(s.id)) continue;
      const patch = blob.edits[s.id];
      merged.push(patch ? { ...s, ...patch } : s);
    }
    return merged;
  }, [blob]);

  const isUserVendor = useCallback(
    (id: string) => blob.added.some((v) => v.id === id),
    [blob.added],
  );

  const getVendor = useCallback(
    (id: string): Vendor | undefined => vendors.find((v) => v.id === id),
    [vendors],
  );

  const invoicesFor = useCallback(
    (vendorId: string): readonly VendorInvoice[] =>
      blob.invoices.filter((i) => i.vendorId === vendorId),
    [blob.invoices],
  );

  const documentsFor = useCallback(
    (vendorId: string): readonly VendorDocument[] =>
      blob.documents.filter((d) => d.vendorId === vendorId),
    [blob.documents],
  );

  const addVendor = useCallback(
    (input: VendorInput): Vendor => {
      const vendor: Vendor = {
        id: newId('v'),
        outstanding: input.outstanding ?? 0n,
        last: input.last ?? '—',
        createdAt: new Date().toISOString(),
        ...input,
      };
      persist({ ...blob, added: [vendor, ...blob.added] });
      return vendor;
    },
    [blob, persist],
  );

  const updateVendor = useCallback(
    (id: string, patch: Partial<Omit<Vendor, 'id'>>) => {
      const isUser = blob.added.some((v) => v.id === id);
      if (isUser) {
        persist({
          ...blob,
          added: blob.added.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        });
      } else {
        persist({
          ...blob,
          edits: { ...blob.edits, [id]: { ...(blob.edits[id] ?? {}), ...patch } },
        });
      }
    },
    [blob, persist],
  );

  const removeVendor = useCallback(
    (id: string) => {
      const isUser = blob.added.some((v) => v.id === id);
      // Cascade: drop the vendor's invoices + documents along with it.
      const invoices = blob.invoices.filter((i) => i.vendorId !== id);
      const documents = blob.documents.filter((d) => d.vendorId !== id);
      if (isUser) {
        persist({
          ...blob,
          added: blob.added.filter((v) => v.id !== id),
          invoices,
          documents,
        });
      } else {
        // Drop edit overlay too — no point keeping it for a tombstoned entry.
        const restEdits = { ...blob.edits };
        delete restEdits[id];
        persist({
          ...blob,
          edits: restEdits,
          removed: blob.removed.includes(id) ? blob.removed : [...blob.removed, id],
          invoices,
          documents,
        });
      }
    },
    [blob, persist],
  );

  const addInvoice = useCallback(
    (input: InvoiceInput): VendorInvoice => {
      const invoice: VendorInvoice = {
        id: newId('inv'),
        createdAt: new Date().toISOString(),
        ...input,
      };
      persist({ ...blob, invoices: [invoice, ...blob.invoices] });
      return invoice;
    },
    [blob, persist],
  );

  const updateInvoice = useCallback(
    (id: string, patch: Partial<Omit<VendorInvoice, 'id' | 'vendorId' | 'createdAt'>>) => {
      persist({
        ...blob,
        invoices: blob.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      });
    },
    [blob, persist],
  );

  const removeInvoice = useCallback(
    (id: string) => {
      persist({ ...blob, invoices: blob.invoices.filter((i) => i.id !== id) });
    },
    [blob, persist],
  );

  const addDocument = useCallback(
    (input: DocumentInput): VendorDocument => {
      const doc: VendorDocument = {
        id: newId('doc'),
        uploadedAt: new Date().toISOString(),
        ...input,
      };
      persist({ ...blob, documents: [doc, ...blob.documents] });
      return doc;
    },
    [blob, persist],
  );

  const updateDocument = useCallback(
    (id: string, patch: Partial<Omit<VendorDocument, 'id' | 'vendorId' | 'uploadedAt'>>) => {
      persist({
        ...blob,
        documents: blob.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      });
    },
    [blob, persist],
  );

  const removeDocument = useCallback(
    (id: string) => {
      persist({ ...blob, documents: blob.documents.filter((d) => d.id !== id) });
    },
    [blob, persist],
  );

  return {
    vendors,
    isUserVendor,
    getVendor,
    invoicesFor,
    documentsFor,
    addVendor,
    updateVendor,
    removeVendor,
    addInvoice,
    updateInvoice,
    removeInvoice,
    addDocument,
    updateDocument,
    removeDocument,
  };
}

export type VendorStore = ReturnType<typeof useVendorStore>;
