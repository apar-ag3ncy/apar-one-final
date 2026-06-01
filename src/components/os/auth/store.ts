'use client';

// Auth store for the Apār One demo.
//
// Demo-grade only. Backed by localStorage with plaintext credentials and no
// session token — fine for showing the RBAC shape, **catastrophic** for prod.
// CLAUDE.md mandates Supabase Auth + Postgres RLS for the real thing; this
// module's surface is what those real bits will eventually replace.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { emptyPermissions, fullPermissions, type Permissions, type User } from './types';

const USERS_KEY = 'apar-os:users';
const SESSION_KEY = 'apar-os:session';
const SUPER_ADMIN_KEY = 'apar-os:super-admin';

/**
 * The super admin record is editable, but the `id` is fixed forever so
 * existing sessions and per-user storage keys never break. Identity, password,
 * and tone are stored in localStorage under SUPER_ADMIN_KEY; if absent we
 * fall back to these defaults.
 */
const SUPER_ADMIN_ID = 'super-admin';
const SUPER_ADMIN_DEFAULTS = {
  username: 'apar',
  fullName: 'Apār Admin',
  password: 'apar2026',
  tone: '#E63A1F',
};

type SuperAdminOverrides = typeof SUPER_ADMIN_DEFAULTS;

function readSuperAdminOverrides(): SuperAdminOverrides {
  if (typeof window === 'undefined') return SUPER_ADMIN_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(SUPER_ADMIN_KEY);
    if (!raw) return SUPER_ADMIN_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<SuperAdminOverrides>;
    return {
      username: parsed.username?.trim() || SUPER_ADMIN_DEFAULTS.username,
      fullName: parsed.fullName?.trim() || SUPER_ADMIN_DEFAULTS.fullName,
      password: parsed.password || SUPER_ADMIN_DEFAULTS.password,
      tone: parsed.tone || SUPER_ADMIN_DEFAULTS.tone,
    };
  } catch {
    return SUPER_ADMIN_DEFAULTS;
  }
}

function persistSuperAdmin(v: SuperAdminOverrides) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SUPER_ADMIN_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

function makeSuperAdmin(): User {
  const o = readSuperAdminOverrides();
  return {
    id: SUPER_ADMIN_ID,
    username: o.username,
    fullName: o.fullName,
    password: o.password,
    role: 'super_admin',
    tone: o.tone,
    permissions: fullPermissions(),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/* -------------------------------------------------------------------------- */
/* External store — written via setState, read via useSyncExternalStore.      */
/* -------------------------------------------------------------------------- */

type State = {
  users: User[]; // additional users only — super admin is implicit
  sessionUserId: string | null;
  // Cache the super admin record so consumers don't have to rebuild it
  // on every render. Updated whenever we persist overrides.
  superAdmin: User;
};

let state: State = {
  users: [],
  sessionUserId: null,
  superAdmin: { ...makeSuperAdmin() }, // typeof window === 'undefined' returns defaults on server
};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function loadFromStorage() {
  if (typeof window === 'undefined') return;
  try {
    const rawUsers = window.localStorage.getItem(USERS_KEY);
    const rawSession = window.localStorage.getItem(SESSION_KEY);
    const users: User[] = rawUsers ? (JSON.parse(rawUsers) as User[]) : [];
    state = {
      users,
      sessionUserId: rawSession || null,
      superAdmin: makeSuperAdmin(),
    };
  } catch {
    state = { users: [], sessionUserId: null, superAdmin: makeSuperAdmin() };
  }
}

function persistUsers() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(state.users));
  } catch {
    // ignore
  }
}

function persistSession() {
  if (typeof window === 'undefined') return;
  try {
    if (state.sessionUserId) {
      window.localStorage.setItem(SESSION_KEY, state.sessionUserId);
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

function getSnapshot(): State {
  return state;
}

// SSR snapshot — no session, no users. Hydration kicks in once the client store loads.
const SSR_STATE: State = {
  users: [],
  sessionUserId: null,
  superAdmin: makeSuperAdmin(),
};
function getServerSnapshot(): State {
  return SSR_STATE;
}

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  loadFromStorage();
}

/* -------------------------------------------------------------------------- */
/* Public hook                                                                */
/* -------------------------------------------------------------------------- */

export type AuthApi = {
  currentUser: User | null;
  allUsers: readonly User[];
  /** Returns true on success, false if username/password didn't match. */
  signIn: (username: string, password: string) => boolean;
  signOut: () => void;
  createUser: (input: {
    username: string;
    fullName: string;
    password: string;
    tone?: string;
  }) => { ok: true; user: User } | { ok: false; error: string };
  updateUser: (id: string, patch: Partial<Pick<User, 'fullName' | 'password' | 'tone'>>) => void;
  /** Update the super admin record (id is fixed). Use for the super admin's own editable card. */
  updateSuperAdmin: (
    patch: Partial<Pick<User, 'fullName' | 'username' | 'password' | 'tone'>>,
  ) => { ok: true } | { ok: false; error: string };
  deleteUser: (id: string) => void;
  setPermissions: (id: string, perms: Permissions) => void;
  resetAllPermissionsTo: (id: string, mode: 'none' | 'all') => void;
};

export function useAuth(): AuthApi {
  // Eager-load on first client render.
  if (typeof window !== 'undefined') ensureLoaded();

  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Resolve the current user. Super admin's id is constant; everyone else
  // lives in `users`. Returns `null` if the session is stale (user deleted).
  const currentUser: User | null =
    snap.sessionUserId === SUPER_ADMIN_ID
      ? snap.superAdmin
      : (snap.users.find((u) => u.id === snap.sessionUserId) ?? null);

  const allUsers: readonly User[] = [snap.superAdmin, ...snap.users];

  const signIn = useCallback((username: string, password: string): boolean => {
    const sa = state.superAdmin;
    if (username.toLowerCase() === sa.username.toLowerCase() && password === sa.password) {
      state = { ...state, sessionUserId: SUPER_ADMIN_ID };
      persistSession();
      emit();
      return true;
    }
    const u = state.users.find(
      (x) => x.username.toLowerCase() === username.toLowerCase() && x.password === password,
    );
    if (!u) return false;
    state = { ...state, sessionUserId: u.id };
    persistSession();
    emit();
    return true;
  }, []);

  const signOut = useCallback(() => {
    state = { ...state, sessionUserId: null };
    persistSession();
    emit();
  }, []);

  const createUser = useCallback<AuthApi['createUser']>((input) => {
    const username = input.username.trim();
    if (!username) return { ok: false, error: 'Username is required.' };
    if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (!input.password || input.password.length < 4)
      return { ok: false, error: 'Password must be at least 4 characters.' };
    if (
      username.toLowerCase() === state.superAdmin.username.toLowerCase() ||
      state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())
    ) {
      return { ok: false, error: `Username "${username}" is already taken.` };
    }
    const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const user: User = {
      id,
      username,
      fullName: input.fullName.trim() || username,
      password: input.password,
      role: 'admin',
      tone: input.tone ?? pickTone(state.users.length),
      permissions: emptyPermissions(),
      createdAt: new Date().toISOString(),
    };
    state = { ...state, users: [...state.users, user] };
    persistUsers();
    emit();
    return { ok: true, user };
  }, []);

  const updateUser = useCallback<AuthApi['updateUser']>((id, patch) => {
    state = {
      ...state,
      users: state.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    };
    persistUsers();
    emit();
  }, []);

  const updateSuperAdmin = useCallback<AuthApi['updateSuperAdmin']>((patch) => {
    const next: SuperAdminOverrides = {
      username: (patch.username ?? state.superAdmin.username).trim(),
      fullName: (patch.fullName ?? state.superAdmin.fullName).trim(),
      password: patch.password ?? state.superAdmin.password,
      tone: patch.tone ?? state.superAdmin.tone,
    };
    if (!next.username) return { ok: false, error: 'Username is required.' };
    if (next.username.length < 3)
      return { ok: false, error: 'Username must be at least 3 characters.' };
    if (!next.fullName) return { ok: false, error: 'Name is required.' };
    if (!next.password || next.password.length < 4)
      return { ok: false, error: 'Password must be at least 4 characters.' };
    // Username can't collide with an existing regular user.
    if (state.users.some((u) => u.username.toLowerCase() === next.username.toLowerCase())) {
      return { ok: false, error: `Username "${next.username}" is already taken.` };
    }
    persistSuperAdmin(next);
    state = {
      ...state,
      superAdmin: { ...state.superAdmin, ...next },
    };
    emit();
    return { ok: true };
  }, []);

  const deleteUser = useCallback<AuthApi['deleteUser']>((id) => {
    state = {
      ...state,
      users: state.users.filter((u) => u.id !== id),
      // If the deleted user was signed in, bump them out.
      sessionUserId: state.sessionUserId === id ? null : state.sessionUserId,
    };
    persistUsers();
    persistSession();
    emit();
  }, []);

  const setPermissions = useCallback<AuthApi['setPermissions']>((id, perms) => {
    state = {
      ...state,
      users: state.users.map((u) => (u.id === id ? { ...u, permissions: perms } : u)),
    };
    persistUsers();
    emit();
  }, []);

  const resetAllPermissionsTo = useCallback<AuthApi['resetAllPermissionsTo']>((id, mode) => {
    const next = mode === 'all' ? fullPermissions() : emptyPermissions();
    // Admin Console is super-admin-only; never grant it to a regular admin even on "all".
    next.admin_console = { view: false, edit: false, delete: false };
    state = {
      ...state,
      users: state.users.map((u) => (u.id === id ? { ...u, permissions: next } : u)),
    };
    persistUsers();
    emit();
  }, []);

  return {
    currentUser,
    allUsers,
    signIn,
    signOut,
    createUser,
    updateUser,
    updateSuperAdmin,
    deleteUser,
    setPermissions,
    resetAllPermissionsTo,
  };
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const TONES = ['#B5391E', '#5B6677', '#7A4E2D', '#2E8F5A', '#C46A28', '#9B3826', '#D08A1E'];
function pickTone(seed: number): string {
  return TONES[seed % TONES.length] ?? TONES[0]!;
}

/**
 * Convenience hook for components that just need to know whether someone is
 * signed in. Triggers a re-render on auth changes via the underlying store.
 */
export function useIsSignedIn(): boolean {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  if (typeof window !== 'undefined') ensureLoaded();
  return state.sessionUserId !== null;
}

/** Used by the lock screen to render the row of avatars. */
export function listKnownUsers(): readonly User[] {
  if (typeof window !== 'undefined') ensureLoaded();
  return [state.superAdmin, ...state.users];
}

/** Exposed so per-user storage keys (settings, session snapshot) can use the same id. */
export const SUPER_ADMIN_USER_ID = SUPER_ADMIN_ID;
