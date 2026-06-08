'use client';

// Per-user OS preferences.
//
// Settings (theme, dock size, dock spacing, reduced motion) live under
// `apar-os:settings:${uid}`. Window-state persistence used to live here
// too (`apar-os:session:${uid}`); in Phase 2 it was replaced by per-window
// URL state (see `lib/url/per-window-nuqs.ts`), so refresh / link-paste
// restores windows from the URL rather than localStorage.

import { useCallback, useEffect, useState } from 'react';

import {
  getUserPreferences,
  resetUserPreferences,
  saveUserPreferences,
} from '@/lib/server/entities/user-preferences';

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
  /** Accent colour (applied as the `--accent` CSS var on `.os-root`). */
  accent: string;
  /** App id to auto-open on login (empty = none). */
  defaultLandingApp: string;
};

/** Selectable accent colours (must match the server PrefsSchema enum). */
export const ACCENTS = ['#E63A1F', '#7A4E2D', '#5B6677', '#2E8F5A', '#3A5BA0'] as const;

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  dockItemSize: 48,
  dockGap: 12, // looser default — the previous 6 was too tight
  reducedMotion: false,
  accent: '#E63A1F',
  defaultLandingApp: '',
};

export const DOCK_SIZE_MIN = 32;
export const DOCK_SIZE_MAX = 80;
export const DOCK_GAP_MIN = 6;
export const DOCK_GAP_MAX = 32;

function settingsKey(userId: string) {
  return `apar-os:settings:${userId}`;
}

/** Coerce a partial/untrusted settings object (localStorage cache OR the DB
 *  prefs blob) into a valid, clamped UserSettings. */
function coerceSettings(parsed: Partial<UserSettings> | null | undefined): UserSettings {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_SETTINGS;
  return {
    theme: parsed.theme === 'dark' ? 'dark' : 'light',
    dockItemSize: clamp(
      Number(parsed.dockItemSize ?? DEFAULT_SETTINGS.dockItemSize),
      DOCK_SIZE_MIN,
      DOCK_SIZE_MAX,
    ),
    dockGap: clamp(Number(parsed.dockGap ?? DEFAULT_SETTINGS.dockGap), DOCK_GAP_MIN, DOCK_GAP_MAX),
    reducedMotion: parsed.reducedMotion === true,
    accent: (ACCENTS as readonly string[]).includes(parsed.accent ?? '')
      ? (parsed.accent as string)
      : DEFAULT_SETTINGS.accent,
    defaultLandingApp: typeof parsed.defaultLandingApp === 'string' ? parsed.defaultLandingApp : '',
  };
}

function readSettings(userId: string): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(settingsKey(userId));
    if (!raw) return DEFAULT_SETTINGS;
    return coerceSettings(JSON.parse(raw) as Partial<UserSettings>);
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
 * Per-user settings hook. Stores theme, dock size, dock gap, reduced motion —
 * persisted SERVER-SIDE (user_preferences table) so they sync and are
 * remembered across sessions / devices / logins.
 *
 * - Lazy init from the localStorage cache for an instant paint (no flash of
 *   defaults on reload).
 * - On mount, loads the authoritative prefs from the DB and applies them.
 * - Every patch updates state, refreshes the cache, AND writes through to the
 *   DB (so a change on one device shows up on the next login elsewhere).
 */
export function useUserSettings(userId: string) {
  const [settings, setSettingsState] = useState<UserSettings>(() => readSettings(userId));
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Hydrate from the DB on login — the server is the source of truth.
  useEffect(() => {
    let cancelled = false;
    getUserPreferences()
      .then((prefs) => {
        if (cancelled) return;
        const next = coerceSettings(prefs as Partial<UserSettings>);
        setSettingsState(next);
        writeSettings(userId, next);
      })
      .catch(() => {
        /* offline / no session — keep the cached settings */
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      setSettingsState((prev) => {
        const next = coerceSettings({ ...prev, ...patch });
        writeSettings(userId, next); // optimistic cache
        // Write through to the DB (fire-and-forget; cache covers a failure).
        void saveUserPreferences(patch).catch(() => {});
        return next;
      });
    },
    [userId],
  );

  // Clear the user's saved prefs on the server and revert the UI to defaults.
  // We set state directly (no write-through) so we don't immediately re-create
  // the row we just deleted.
  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    writeSettings(userId, DEFAULT_SETTINGS);
    void resetUserPreferences().catch(() => {});
  }, [userId]);

  return { settings, setSettings, resetSettings, settingsLoaded };
}

// Session-snapshot persistence (`apar-os:session:${uid}`) was removed in
// Phase 2 — see `lib/url/per-window-nuqs.ts` for the replacement. Any
// stale localStorage entries under that key are inert and will be GC'd
// next time the user clears site data.
