'use client';

// OS data-access boundary. Phase 3 of the brief — now wired to the real
// server actions (T2 of the OS-frontend session).
//
// Hooks return the `{ data, isLoading, error }` triple shape so callers can
// switch transports later without changing their JSX. We use the existing
// useEffect/useState pattern rather than React Query — React Query is not
// in the dep tree and adding it would need explicit approval (CLAUDE.md).
//
// Server-action imports here are SAFE inside client components: server
// actions cross the network boundary automatically via Next's 'use server'
// directive at the action file head. No Supabase JS client calls happen
// in browser code.

import { useEffect, useState } from 'react';

import {
  getTransaction,
  listClients as listDbClients,
  listEmployees as listDbEmployees,
  listProjects as listDbProjects,
  listVendors as listDbVendors,
} from '@/lib/server-stub/entity-actions';
import { getDocumentSignedUrl } from '@/lib/server/entities/documents';
import type { Transaction } from '@/components/entity/transaction-list';
import type { TransactionDetailData } from '@/components/entity/transaction-detail';

export type Result<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
};

function pending<T>(): Result<T> {
  return { data: undefined, isLoading: true, error: null };
}
function ok<T>(data: T): Result<T> {
  return { data, isLoading: false, error: null };
}
function failed<T>(err: Error): Result<T> {
  return { data: undefined, isLoading: false, error: err };
}

/**
 * Small useAsync helper for the read-only list endpoints. Cancels stale
 * promises on unmount + dep change so a fast tab switch doesn't render
 * the previous entity's data.
 */
function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList): Result<T> {
  const [state, setState] = useState<Result<T>>(pending<T>());

  useEffect(() => {
    let cancelled = false;
    // queueMicrotask so the setState doesn't fire synchronously inside the
    // effect — appeases the react-hooks no-sync-render rule.
    queueMicrotask(() => {
      if (!cancelled) setState(pending<T>());
    });
    loader()
      .then((data) => {
        if (!cancelled) setState(ok(data));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState(failed<T>(e instanceof Error ? e : new Error('Failed to load')));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                      */
/* -------------------------------------------------------------------------- */

import type { Client as DashClient } from '@/components/clients/types';
import type { Vendor as DashVendor } from '@/components/vendors/types';
import type { Employee as DashEmployee } from '@/components/employees/types';
import type { Project as DashProject } from '@/components/projects/types';

export function useClients(): Result<readonly DashClient[]> {
  return useAsync(() => listDbClients(), []);
}

export function useVendors(): Result<readonly DashVendor[]> {
  return useAsync(() => listDbVendors(), []);
}

export function useEmployees(): Result<readonly DashEmployee[]> {
  return useAsync(() => listDbEmployees(), []);
}

export function useProjects(): Result<readonly DashProject[]> {
  return useAsync(() => listDbProjects(), []);
}

/**
 * Transactions for a given scope.
 *
 * TODO(human): no global `listTransactions(scope, entityId)` server action
 * exists yet — BACKEND-STATE.md flags this as still-MISSING. Per-client and
 * per-vendor lists are already wired (`listClientTransactions`, the
 * vendor-bills section's loader). The Ledger window's "all" scope returns
 * an empty array until that server action ships.
 */
export function useTransactions(opts?: {
  scope?: 'all' | 'entity';
  entityId?: string;
}): Result<readonly Transaction[]> {
  void opts;
  return ok<readonly Transaction[]>([]);
}

/* -------------------------------------------------------------------------- */
/* Single-entity reads                                                        */
/* -------------------------------------------------------------------------- */

export function useClient(id: string | undefined): Result<DashClient | null> {
  return useAsync(async () => {
    if (!id) return null;
    const all = await listDbClients();
    return all.find((c) => c.id === id) ?? null;
  }, [id]);
}

export function useVendor(id: string | undefined): Result<DashVendor | null> {
  return useAsync(async () => {
    if (!id) return null;
    const all = await listDbVendors();
    return all.find((v) => v.id === id) ?? null;
  }, [id]);
}

/**
 * Single transaction with its double-entry postings (joined to the chart of
 * accounts) + source-document ids. Backed by `getTransaction` against the
 * real ledger tables.
 */
export function useTransaction(id: string | undefined): Result<TransactionDetailData | null> {
  return useAsync(async () => {
    if (!id) return null;
    return await getTransaction(id);
  }, [id]);
}

/**
 * Signed URL for a document. Calls `getDocumentSignedUrl` (server action)
 * which wraps `lib/storage.ts:getSignedDocumentUrl` — 5-min TTL per
 * CLAUDE rule #33, refuses the restricted-kyc bucket (use revealKyc
 * for that path instead).
 */
export async function resolveDocumentUrl(
  documentId: string,
): Promise<{ url: string; expiresAt: string; mimeType: string; name: string }> {
  const result = await getDocumentSignedUrl(documentId);
  return {
    url: result.url,
    expiresAt: result.expiresAt,
    mimeType: result.mimeType,
    name: result.name,
  };
}
