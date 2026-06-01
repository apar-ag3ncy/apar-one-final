'use client';

// Per-user OS preferences.
//
// Settings (theme, dock size, dock spacing, reduced motion) live under
// `apar-os:settings:${uid}`. Window-state persistence used to live here
// too (`apar-os:session:${uid}`); in Phase 2 it was replaced by per-window
// URL state (see `lib/url/per-window-nuqs.ts`), so refresh / link-paste
// restores windows from the URL rather than localStorage.

import { useCallback, useState } from 'react';

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export type UserSettings = {
  theme: 'light' | 'dark';
  /** Pixel size of each dock item (32–80). */
  dockItemSize: number;
  /** Gap between dock items in pixels (6–32). */
  dockGap: number;
  /**
   * Soften window open/close/genie transitions. CSS reads
   * `[data-reduced-motion="true"]` on `.os-root` and downgrades motion
   * to opacity-only fades. Independent of the OS `prefers-reduced-motion`
   * media query so users can opt in regardless of OS setting.
   */
  reducedMotion: boolean;
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  dockItemSize: 48,
  dockGap: 12, // looser default — the previous 6 was too tight
  reducedMotion: false,
};

export const DOCK_SIZE_MIN = 32;
export const DOCK_SIZE_MAX = 80;
export const DOCK_GAP_MIN = 6;
export const DOCK_GAP_MAX = 32;

function settingsKey(userId: string) {
  return `apar-os:settings:${userId}`;
}

function readSettings(userId: string): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(settingsKey(userId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      dockItemSize: clamp(
        parsed.dockItemSize ?? DEFAULT_SETTINGS.dockItemSize,
        DOCK_SIZE_MIN,
        DOCK_SIZE_MAX,
      ),
      dockGap: clamp(parsed.dockGap ?? DEFAULT_SETTINGS.dockGap, DOCK_GAP_MIN, DOCK_GAP_MAX),
      reducedMotion: parsed.reducedMotion === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(userId: string, value: UserSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(settingsKey(userId), JSON.stringify(value));
  } catch {
    // ignore
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Per-user settings hook. Stores theme, dock size, dock gap.
 *
 * Lazy init reads from localStorage on first render. Every patch writes back
 * synchronously, so a tab close or sign-out can't lose the setting.
 */
export function useUserSettings(userId: string) {
  const [settings, setSettingsState] = useState<UserSettings>(() => readSettings(userId));

  const setSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettingsState((prev) => {
        const next: UserSettings = {
          theme: patch.theme ?? prev.theme,
          dockItemSize: clamp(
            patch.dockItemSize ?? prev.dockItemSize,
            DOCK_SIZE_MIN,
            DOCK_SIZE_MAX,
          ),
          dockGap: clamp(patch.dockGap ?? prev.dockGap, DOCK_GAP_MIN, DOCK_GAP_MAX),
          reducedMotion: patch.reducedMotion ?? prev.reducedMotion,
        };
        writeSettings(userId, next);
        return next;
      });
    },
    [userId],
  );

  return { settings, setSettings };
}

// Session-snapshot persistence (`apar-os:session:${uid}`) was removed in
// Phase 2 — see `lib/url/per-window-nuqs.ts` for the replacement. Any
// stale localStorage entries under that key are inert and will be GC'd
// next time the user clears site data.
