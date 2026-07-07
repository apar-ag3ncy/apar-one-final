'use client';

// Per-window URL state for the Apar One OS.
//
// Spec: SESSION-C-OS-BROWNFIELD §Phase 2.3 + FRONTEND-OS-AUDIT §6 (P2-3).
// URL shape:
//
//     ?windows=w1,w2,w3 &
//     w1=clients:abc:overview &
//     w2=vendors:def:transactions &
//     w3=settings::roles
//
// Each `wN` is `app[:entityId[:tab]]`. An empty segment means "no value";
// a missing tail segment means "default". So `settings::roles` parses to
// `{ app: 'settings', entityId: undefined, tab: 'roles' }`.
//
// Geometry (x/y/width/height) is NOT encoded — that's per-device state.
// Only the identity tuple goes into the URL so a link reproduces the same
// windows on whatever desktop you paste it into.
//
// Hard budget: 300 LOC (per the kickoff). Currently ~155.

import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useRef } from 'react';
import { osActions, useOsStore, type WindowState } from '@/lib/os/store';
import type { AppId } from '@/components/os/types';

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const VALID_APPS: ReadonlySet<AppId> = new Set<AppId>([
  'clients',
  'vendors',
  'projects',
  'employees',
  'accounts',
  'attendance',
  'ledger',
  'reports',
  'settings',
  'admin_console',
  // Phase 4 windows — paste-able via URL too, e.g.
  // `?windows=w1&w1=transactions:tx_abc` to deep-link a tx detail.
  'transactions',
  'documents',
  'bank_recon',
]);

function isAppId(value: string): value is AppId {
  return VALID_APPS.has(value as AppId);
}

/**
 * `app:entityId:tab` — empty trailing segments are dropped. Returns null
 * if the shape can't be parsed (we silently ignore broken slots).
 */
export function encodeSlot(w: Pick<WindowState, 'app' | 'entityId' | 'tab'>): string {
  const parts = [w.app, w.entityId ?? '', w.tab ?? ''];
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.join(':');
}

export function decodeSlot(raw: string): { app: AppId; entityId?: string; tab?: string } | null {
  if (!raw) return null;
  const [app, entityId, tab] = raw.split(':');
  if (!app || !isAppId(app)) return null;
  return {
    app,
    entityId: entityId && entityId.length > 0 ? entityId : undefined,
    tab: tab && tab.length > 0 ? tab : undefined,
  };
}

// ---------------------------------------------------------------------------
// URL <-> store sync
// ---------------------------------------------------------------------------

const MAX_WINDOWS_IN_URL = 24; // hard cap so a malicious URL can't blow up the dock

type SlotKey = `w${number}`;

function buildSlotParsers(): Record<SlotKey, ReturnType<typeof parseAsString.withDefault>> {
  // nuqs requires a static set of keys; allocate up to MAX in advance.
  const parsers = {} as Record<SlotKey, ReturnType<typeof parseAsString.withDefault>>;
  for (let i = 1; i <= MAX_WINDOWS_IN_URL; i += 1) {
    parsers[`w${i}` as SlotKey] = parseAsString.withDefault('');
  }
  return parsers;
}

const SLOT_PARSERS = buildSlotParsers();

function readUrlWindows(
  windowsParam: string,
  slots: Record<string, string>,
): { app: AppId; entityId?: string; tab?: string }[] {
  if (!windowsParam) return [];
  const ids = windowsParam.split(',').filter(Boolean).slice(0, MAX_WINDOWS_IN_URL);
  const out: { app: AppId; entityId?: string; tab?: string }[] = [];
  for (const id of ids) {
    const raw = slots[id];
    if (!raw) continue;
    const parsed = decodeSlot(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

export type UseWindowUrlSyncOptions = {
  /**
   * View-permission gate. Returns whether the current user may open a given
   * app. URL-restored windows are the one open path that does NOT go through
   * `openApp` (which enforces `can(user, app, 'view')`), so without this a
   * crafted `?windows=…` link would open apps the operator never granted.
   * When omitted, every app is allowed (back-compat / non-gated callers).
   */
  canView?: (app: AppId) => boolean;
};

/**
 * Bidirectional sync between the OS store and the URL.
 *
 * Direction A (URL → store): runs once on mount. If the URL has a non-empty
 * `?windows=...`, hydrate the store from the URL. The store wins on first
 * paint after that — refreshes restore from the URL, not the store. Windows
 * for apps the user can't view are dropped here so a shared/pasted link can
 * never bypass the RBAC `view` gate.
 *
 * Direction B (store → URL): runs whenever the store's identity tuple
 * changes. URL changes are batched via nuqs's `history: 'replace'` so they
 * don't pollute the back stack.
 */
export function useWindowUrlSync(options: UseWindowUrlSyncOptions = {}): void {
  const { canView } = options;
  const slots = useOsStore((s) => ({
    ids: s.windows.map((w) => w.id),
    tuples: s.windows.map((w) => ({ id: w.id, app: w.app, entityId: w.entityId, tab: w.tab })),
  }));

  const [urlState, setUrlState] = useQueryStates(
    { windows: parseAsString.withDefault(''), ...SLOT_PARSERS },
    { history: 'replace', shallow: true },
  );

  // ---- A: hydrate once on first mount if URL has windows but store is empty.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (slots.ids.length > 0) return; // store already populated (e.g. legacy localStorage)
    const fromUrl = readUrlWindows(urlState.windows, urlState as unknown as Record<string, string>);
    if (fromUrl.length === 0) return;
    // Open windows in order; positions cascade. Enforce the `view` gate so a
    // pasted deep-link can't surface an app the operator didn't grant — this
    // is the one open path that bypasses `openApp`'s permission check.
    for (const w of fromUrl) {
      if (canView && !canView(w.app)) continue;
      osActions.openWindow({
        app: w.app,
        entityId: w.entityId,
        tab: w.tab,
        position: 'cascade',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- B: keep URL in sync with store.
  useEffect(() => {
    if (!hydrated.current) return; // skip the very first render
    const next: Record<string, string> = { windows: '' };
    for (let i = 1; i <= MAX_WINDOWS_IN_URL; i += 1) next[`w${i}`] = '';
    const order: string[] = [];
    slots.tuples.forEach((t, i) => {
      if (i >= MAX_WINDOWS_IN_URL) return;
      const key = `w${i + 1}`;
      order.push(key);
      next[key] = encodeSlot(t);
    });
    next.windows = order.join(',');
    setUrlState(next).catch(() => {
      /* nuqs throws if unmounted mid-flight; harmless */
    });
  }, [slots, setUrlState]);
}
