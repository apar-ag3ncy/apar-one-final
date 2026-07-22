'use client';

// Per-user OS preferences.
//
// Settings (theme, dock size, dock spacing, reduced motion) live under
// `apar-os:settings:${uid}`. Window-state persistence used to live here
// too (`apar-os:session:${uid}`); in Phase 2 it was replaced by per-window
// URL state (see `lib/url/per-window-nuqs.ts`), so refresh / link-paste
// restores windows from the URL rather than localStorage.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getUserPreferences,
  resetUserPreferences,
  saveUserPreferences,
} from '@/lib/server/entities/user-preferences';

/**
 * Pluggable persistence backend for useUserSettings. Defaults to the operator
 * `user_preferences` table; the employee OS session passes a self-scoped
 * backend (employee-portal getMyPreferences/saveMyPreferences) because the
 * operator prefs actions deny employee sessions.
 */
export type PrefsBackend = {
  load: () => Promise<Partial<UserSettings> | null>;
  save: (patch: Partial<UserSettings>) => Promise<unknown>;
  reset: () => Promise<unknown>;
};

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
  /** Notification preferences (Settings → Notifications). */
  notifications: NotificationSettings;
};

/** Per-user notification toggles. Persisted in the same prefs blob. */
export type NotificationSettings = {
  invoicePaymentReminders: boolean;
  overdueAlerts: boolean;
  weeklySummary: boolean;
  inAppToasts: boolean;
};

/** Selectable accent colours (must match the server PrefsSchema enum). */
export const ACCENTS = ['#E63A1F', '#7A4E2D', '#5B6677', '#2E8F5A', '#3A5BA0'] as const;

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  invoicePaymentReminders: true,
  overdueAlerts: true,
  weeklySummary: false,
  inAppToasts: true,
};

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  dockItemSize: 48,
  dockGap: 12, // looser default — the previous 6 was too tight
  reducedMotion: false,
  accent: '#E63A1F',
  defaultLandingApp: '',
  notifications: DEFAULT_NOTIFICATIONS,
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
    // Always emit the FULL notifications object: the server-side jsonb merge is
    // shallow, so a partial would drop sibling toggles on the next save.
    notifications: coerceNotifications(parsed.notifications),
  };
}

function coerceNotifications(
  n: Partial<NotificationSettings> | null | undefined,
): NotificationSettings {
  if (!n || typeof n !== 'object') return DEFAULT_NOTIFICATIONS;
  return {
    invoicePaymentReminders:
      typeof n.invoicePaymentReminders === 'boolean'
        ? n.invoicePaymentReminders
        : DEFAULT_NOTIFICATIONS.invoicePaymentReminders,
    overdueAlerts:
      typeof n.overdueAlerts === 'boolean' ? n.overdueAlerts : DEFAULT_NOTIFICATIONS.overdueAlerts,
    weeklySummary:
      typeof n.weeklySummary === 'boolean' ? n.weeklySummary : DEFAULT_NOTIFICATIONS.weeklySummary,
    inAppToasts:
      typeof n.inAppToasts === 'boolean' ? n.inAppToasts : DEFAULT_NOTIFICATIONS.inAppToasts,
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
export function useUserSettings(userId: string, backend?: PrefsBackend) {
  const [settings, setSettingsState] = useState<UserSettings>(() => readSettings(userId));
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Capture the backend once. It's stable per mount (Desktop is keyed by user
  // id, and the employee backend is memoized on role), so the callbacks can
  // read it from the ref without listing it in their deps.
  const backendRef = useRef(backend);

  // Hydrate from the server on login — the source of truth (operator prefs
  // table, or the employee's own ui_prefs). Falls back to the cache on failure.
  useEffect(() => {
    let cancelled = false;
    const load =
      backendRef.current?.load ?? (() => getUserPreferences() as Promise<Partial<UserSettings>>);
    load()
      .then((prefs) => {
        if (cancelled || !prefs) return;
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
        // Write through to the account (fire-and-forget; cache covers failure).
        const save =
          backendRef.current?.save ?? ((p: Partial<UserSettings>) => saveUserPreferences(p));
        void Promise.resolve(save(patch)).catch(() => {});
        return next;
      });
    },
    [userId],
  );

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    writeSettings(userId, DEFAULT_SETTINGS);
    const reset = backendRef.current?.reset ?? (() => resetUserPreferences());
    void Promise.resolve(reset()).catch(() => {});
  }, [userId]);

  return { settings, setSettings, resetSettings, settingsLoaded };
}

// Session-snapshot persistence (`apar-os:session:${uid}`) was removed in
// Phase 2 — see `lib/url/per-window-nuqs.ts` for the replacement. Any
// stale localStorage entries under that key are inert and will be GC'd
// next time the user clears site data.
