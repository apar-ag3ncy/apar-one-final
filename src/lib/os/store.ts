'use client';

// Window-manager store for the Apar One OS shell.
//
// Spec source: SESSION-C-OS-BROWNFIELD §Phase 2 + FRONTEND-OS-AUDIT §6 (P2-1/2/3).
// The shape mirrors Zustand's contract intentionally — when the dep lands
// (NEEDS DEP: zustand), this module's selector + actions move 1:1 across
// without any consumer changes. Until then we back the store with
// `useSyncExternalStore` so React 18+ concurrent rendering stays correct.
//
// Rule 47 ground rule: this store holds **window state only** (id, app,
// entityId, tab, geometry, z-index). It MUST NOT hold entity data — that
// stays in B's shared components, which look entities up by id via React
// Query / server actions once those land.

import { useMemo, useSyncExternalStore } from 'react';
import type { AppId } from '@/components/os/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-window state. 11 fields, under the soft cap of 12 in
 * SESSION-C-OS-BROWNFIELD §Phase 2.5. The legacy `opening` / `preX..preH` /
 * `detailKind` / `detailData` fields from the v0 inline store are gone:
 *
 * - `opening` is now a CSS class swap driven by the consumer's mount effect;
 *   the store doesn't need to know.
 * - Pre-maximize geometry is captured as `restore` (single object) — same
 *   information, half the surface area.
 * - `detailKind` + `detailData` collapse to `entityId` + `tab`. Resolution
 *   of an entity by id is the consumer's job (Rule 47).
 */
export type WindowState = {
  id: string;
  app: AppId;
  title: string;
  entityId?: string;
  tab?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  /** Pre-maximize geometry; cleared on un-maximize. */
  restore?: { x: number; y: number; width: number; height: number };
};

/**
 * Where a newly-opened window lands:
 * - `center`: middle of the viewport, with a small cascade if a same-app
 *   window already sits there
 * - `cascade`: simple offset from previously opened windows (legacy)
 * - `beside-focused`: sits to the right of the focused window — this is
 *   the OS's central UX for `<EntityRef>` clicks (Phase 2.5 in the brief)
 */
export type WindowPosition = 'center' | 'cascade' | 'beside-focused';

export type OpenWindowInput = {
  app: AppId;
  entityId?: string;
  tab?: string;
  title?: string;
  width?: number;
  height?: number;
  position?: WindowPosition;
  /** Default false — pass true to skip the same-app dedupe. */
  alwaysNew?: boolean;
};

export type OsStoreState = {
  windows: WindowState[];
  focusedId: string | null;
  nextZ: number;
};

// ---------------------------------------------------------------------------
// Store machinery (zustand-shaped, useSyncExternalStore-backed)
// ---------------------------------------------------------------------------

let state: OsStoreState = { windows: [], focusedId: null, nextZ: 100 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getState(): OsStoreState {
  return state;
}
function setState(next: OsStoreState) {
  state = next;
  emit();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const DEFAULT_W = 880;
const DEFAULT_H = 580;
const DOCK_GUTTER = 96; // bottom inset for the macOS dock
const TOP_GUTTER = 36; // menubar height
const EDGE_GUTTER = 16; // breathing room from the viewport edges
const MIN_W = 480; // mirror the interactive-resize minimums (window.tsx)
const MIN_H = 360;

function viewport(): { vw: number; vh: number } {
  if (typeof window === 'undefined') return { vw: 1440, vh: 900 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

/**
 * Cap a window's size to the usable desktop area so it can never open larger
 * than the screen (which would push its bottom/right — and the content there —
 * permanently off-screen). Floors at the resize minimums so the window is
 * still usable on tiny viewports.
 */
function clampSize(w: number, h: number): { width: number; height: number } {
  const { vw, vh } = viewport();
  const maxW = Math.max(MIN_W, vw - EDGE_GUTTER * 2);
  const maxH = Math.max(MIN_H, vh - TOP_GUTTER - DOCK_GUTTER - EDGE_GUTTER * 2);
  return { width: Math.min(w, maxW), height: Math.min(h, maxH) };
}

/**
 * Pull a window's top-left corner so the whole frame (given its w/h) stays
 * inside the viewport — below the menubar, above the dock, and within both
 * side edges. Idempotent: a window already on-screen is left unchanged.
 */
function clampPosition(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const { vw, vh } = viewport();
  const usableH = vh - TOP_GUTTER - DOCK_GUTTER;
  const minX = EDGE_GUTTER;
  const maxX = Math.max(minX, vw - w - EDGE_GUTTER);
  const minY = TOP_GUTTER + EDGE_GUTTER;
  const maxY = Math.max(minY, TOP_GUTTER + usableH - h - EDGE_GUTTER);
  return {
    x: Math.min(Math.max(minX, x), maxX),
    y: Math.min(Math.max(minY, y), maxY),
  };
}

function placeFor(
  position: WindowPosition,
  w: number,
  h: number,
  count: number,
  focused: WindowState | null,
) {
  const { vw, vh } = viewport();
  let x: number;
  let y: number;
  if (position === 'beside-focused' && focused) {
    // Prefer sitting to the right of the focused window…
    x = focused.x + focused.width + 16;
    y = focused.y;
  } else if (position === 'cascade') {
    x = 120 + (count % 5) * 30;
    y = TOP_GUTTER + 34 + (count % 5) * 24;
  } else {
    // center (with mild cascade for repeat openings)
    x = Math.round((vw - w) / 2) + (count % 4) * 18;
    y = Math.round((vh - h - DOCK_GUTTER) / 2) + (count % 4) * 14;
  }
  // …but always clamp so the full frame is on-screen regardless of branch.
  return clampPosition(x, y, w, h);
}

let WIN_SEQ = 0;
function newWindowId(): string {
  WIN_SEQ += 1;
  return `w${WIN_SEQ}-${Date.now().toString(36).slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function focusedWindow(): WindowState | null {
  const id = state.focusedId;
  if (!id) return null;
  return state.windows.find((w) => w.id === id) ?? null;
}

function openWindow(input: OpenWindowInput): string {
  const position: WindowPosition = input.position ?? 'center';
  // Clamp to the viewport so a generous per-app default size never opens
  // bigger than the screen — the whole window (and its content) stays visible.
  const { width, height } = clampSize(input.width ?? DEFAULT_W, input.height ?? DEFAULT_H);

  // Dedupe: a non-entity app (e.g. settings) reuses an existing window.
  if (!input.alwaysNew && !input.entityId) {
    const existing = state.windows.find((w) => w.app === input.app && !w.entityId);
    if (existing) {
      // Reusing the window but deep-linking to a different sub-section (`tab`)
      // — refresh the tab so a command-palette jump actually switches the view
      // (e.g. "Invoice format" on an already-open Settings window).
      if (input.tab != null && input.tab !== existing.tab) {
        setState({
          ...state,
          windows: state.windows.map((w) => (w.id === existing.id ? { ...w, tab: input.tab } : w)),
        });
      }
      focusWindow(existing.id);
      return existing.id;
    }
  }
  // Entity-scoped windows also dedupe by (app, entityId, tab).
  if (!input.alwaysNew && input.entityId) {
    const existing = state.windows.find(
      (w) =>
        w.app === input.app &&
        w.entityId === input.entityId &&
        (input.tab == null || w.tab === input.tab),
    );
    if (existing) {
      focusWindow(existing.id);
      return existing.id;
    }
  }

  const { x, y } = placeFor(position, width, height, state.windows.length, focusedWindow());
  const id = newWindowId();
  const z = state.nextZ + 1;
  const next: WindowState = {
    id,
    app: input.app,
    title: input.title ?? '',
    entityId: input.entityId,
    tab: input.tab,
    x,
    y,
    width,
    height,
    zIndex: z,
    isMinimized: false,
    isMaximized: false,
  };
  setState({
    windows: [...state.windows, next],
    focusedId: id,
    nextZ: z,
  });
  return id;
}

function closeWindow(id: string) {
  const windows = state.windows.filter((w) => w.id !== id);
  const focusedId = state.focusedId === id ? (topVisible(windows)?.id ?? null) : state.focusedId;
  setState({ ...state, windows, focusedId });
}

function closeAllWindows() {
  setState({ ...state, windows: [], focusedId: null });
}

function topVisible(ws: WindowState[]): WindowState | null {
  return ws
    .filter((w) => !w.isMinimized)
    .reduce<WindowState | null>((m, w) => (m && m.zIndex > w.zIndex ? m : w), null);
}

function focusWindow(id: string) {
  const nz = state.nextZ + 1;
  setState({
    windows: state.windows.map((w) => (w.id === id ? { ...w, zIndex: nz, isMinimized: false } : w)),
    focusedId: id,
    nextZ: nz,
  });
}

function minimizeWindow(id: string) {
  const wasFocused = state.focusedId === id;
  const windows = state.windows.map((w) => (w.id === id ? { ...w, isMinimized: true } : w));
  setState({
    ...state,
    windows,
    focusedId: wasFocused ? (topVisible(windows)?.id ?? null) : state.focusedId,
  });
}

function maximizeWindow(id: string) {
  const { vw, vh } = viewport();
  setState({
    ...state,
    windows: state.windows.map((w) => {
      if (w.id !== id) return w;
      if (w.isMaximized && w.restore) {
        return { ...w, isMaximized: false, ...w.restore, restore: undefined };
      }
      return {
        ...w,
        isMaximized: true,
        restore: { x: w.x, y: w.y, width: w.width, height: w.height },
        x: 8,
        y: TOP_GUTTER,
        width: vw - 16,
        height: vh - TOP_GUTTER - DOCK_GUTTER,
      };
    }),
  });
}

function moveWindow(id: string, x: number, y: number) {
  setState({
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
  });
}

function resizeWindow(id: string, width: number, height: number) {
  setState({
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, width, height } : w)),
  });
}

function setTab(id: string, tab: string) {
  setState({
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, tab } : w)),
  });
}

function setTitle(id: string, title: string) {
  setState({
    ...state,
    windows: state.windows.map((w) => (w.id === id ? { ...w, title } : w)),
  });
}

/**
 * Replace the entire window set + focusedId in one go. Used by per-window
 * URL state hydration on initial mount so windows opened in another tab
 * appear without flicker.
 */
function hydrate(windows: WindowState[], focusedId: string | null) {
  // URL-restored geometry can come from a larger monitor; clamp each window
  // to this viewport so a shared deep-link never restores an off-screen frame.
  const clamped = windows.map((w) => {
    const { width, height } = clampSize(w.width, w.height);
    const { x, y } = clampPosition(w.x, w.y, width, height);
    return { ...w, width, height, x, y };
  });
  const maxZ = clamped.reduce((m, w) => (w.zIndex > m ? w.zIndex : m), state.nextZ);
  setState({ windows: clamped, focusedId, nextZ: maxZ });
}

export const osActions = {
  openWindow,
  closeWindow,
  closeAllWindows,
  focusWindow,
  minimizeWindow,
  maximizeWindow,
  moveWindow,
  resizeWindow,
  setTab,
  setTitle,
  hydrate,
};

// ---------------------------------------------------------------------------
// React bindings (zustand-shaped)
// ---------------------------------------------------------------------------

const SSR_STATE: OsStoreState = { windows: [], focusedId: null, nextZ: 100 };

/**
 * Hook-shape mirror of `zustand`'s `useStore(selector)`. With a selector,
 * we re-derive the value via `useMemo` on every render against the latest
 * snapshot — selectors stay pure and consumers stay stable across renders
 * via standard React reconciliation. With no selector, returns the full
 * state object.
 *
 * SSR-safe: the server-snapshot returns an empty windows array, matching
 * what the OS root renders on the server.
 */
export function useOsStore(): OsStoreState;
export function useOsStore<T>(selector: (s: OsStoreState) => T): T;
export function useOsStore<T>(selector?: (s: OsStoreState) => T): OsStoreState | T {
  const snapshot = useSyncExternalStore(subscribe, getState, () => SSR_STATE);
  return useMemo(() => (selector ? selector(snapshot) : snapshot), [selector, snapshot]);
}

// ---------------------------------------------------------------------------
// Test-only escape hatch — DO NOT use from app code
// ---------------------------------------------------------------------------

export function __resetOsStoreForTests(): void {
  state = { windows: [], focusedId: null, nextZ: 100 };
  WIN_SEQ = 0;
  emit();
}

/** Test-only snapshot of the raw store state. DO NOT use from app code. */
export function __getOsStateForTests(): OsStoreState {
  return state;
}
