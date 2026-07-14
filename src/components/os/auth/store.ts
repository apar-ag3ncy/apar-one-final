'use client';

// Auth store for Apar One — server-backed.
//
// User accounts live in the `os_users` table (see src/lib/server/os-auth.ts)
// so an account created on one device can be signed into from any other. This
// module is a thin client cache over those server actions: it hydrates once on
// mount, keeps a shared snapshot for useSyncExternalStore consumers, and routes
// every mutation through the server (with optimistic local updates for the
// snappy ones). Passwords never reach the client — they are hashed and verified
// server-side; the `password` field here is only a transient edit-form value.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  bootstrapOsAuth,
  createOsUser,
  deleteOsUser,
  setOsPermissions,
  signInOs,
  signOutOs,
  updateOsUser,
} from '@/lib/server/os-auth';
import { emptyPermissions, fullPermissions, type Permissions, type Role, type User } from './types';

const SUPER_ADMIN_ID = 'super-admin';

/** Coerce a sanitized server user into the client `User` shape. */
function toUser(s: {
  id: string;
  username: string;
  fullName: string;
  role: string;
  tone: string;
  permissions: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  createdAt: string;
}): User {
  return {
    id: s.id,
    username: s.username,
    fullName: s.fullName,
    role: s.role as Role,
    tone: s.tone,
    // Merge over an all-false base so a partial map can't leave gaps.
    permissions: { ...emptyPermissions(), ...(s.permissions as Permissions) },
    createdAt: s.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* External store — module singleton, read via useSyncExternalStore.          */
/* -------------------------------------------------------------------------- */

type State = {
  users: User[]; // all users incl. super admin, as returned by the server
  currentUserId: string | null;
  loading: boolean; // true until the first bootstrap resolves
};

let state: State = { users: [], currentUserId: null, loading: true };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): State {
  return state;
}

// SSR + first client paint: loading, no users. Matches until bootstrap runs.
const SSR_STATE: State = { users: [], currentUserId: null, loading: true };
function getServerSnapshot(): State {
  return SSR_STATE;
}

let bootstrapStarted = false;
async function ensureBootstrap() {
  if (bootstrapStarted) return;
  bootstrapStarted = true;
  try {
    const { users, currentUser } = await bootstrapOsAuth();
    setState({
      users: users.map(toUser),
      currentUserId: currentUser?.id ?? null,
      loading: false,
    });
  } catch {
    // Network/DB blip — stop showing the splash; the lock screen will still
    // render the (server-ensured, but here empty) list once retried.
    setState({ ...state, loading: false });
  }
}

/* -------------------------------------------------------------------------- */
/* Public hook                                                                */
/* -------------------------------------------------------------------------- */

export type AuthApi = {
  loading: boolean;
  currentUser: User | null;
  allUsers: readonly User[];
  /** Resolves true on success, false if the credentials didn't match. */
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  createUser: (input: {
    username: string;
    fullName: string;
    password: string;
    tone?: string;
  }) => Promise<{ ok: true; user: User } | { ok: false; error: string }>;
  updateUser: (
    id: string,
    patch: Partial<Pick<User, 'fullName' | 'password' | 'tone'>>,
  ) => Promise<void>;
  updateSuperAdmin: (
    patch: Partial<Pick<User, 'fullName' | 'username' | 'password' | 'tone'>>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  deleteUser: (id: string) => Promise<void>;
  setPermissions: (id: string, perms: Permissions) => Promise<void>;
  resetAllPermissionsTo: (id: string, mode: 'none' | 'all') => Promise<void>;
};

export function useAuth(): AuthApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Hydrate from the server once, on the client.
  useEffect(() => {
    void ensureBootstrap();
  }, []);

  const currentUser: User | null = snap.users.find((u) => u.id === snap.currentUserId) ?? null;
  const allUsers: readonly User[] = snap.users;

  const signIn = useCallback(async (username: string, password: string): Promise<boolean> => {
    const res = await signInOs(username, password);
    if (!res.ok) return false;
    const user = toUser(res.user);
    setState({
      ...state,
      users: state.users.some((u) => u.id === user.id)
        ? state.users.map((u) => (u.id === user.id ? user : u))
        : [...state.users, user],
      currentUserId: user.id,
    });
    return true;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await signOutOs();
    setState({ ...state, currentUserId: null });
  }, []);

  const createUser = useCallback<AuthApi['createUser']>(async (input) => {
    // Client-side pre-check for instant feedback; the server re-validates.
    const username = input.username.trim();
    if (username.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (!input.password || input.password.length < 4)
      return { ok: false, error: 'Password must be at least 4 characters.' };
    if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: `Username "${username}" is already taken.` };
    }
    const res = await createOsUser({
      username,
      fullName: input.fullName,
      password: input.password,
      tone: input.tone,
      permissions: emptyPermissions(),
    });
    if (!res.ok) return res;
    const user = toUser(res.user);
    setState({ ...state, users: [...state.users, user] });
    return { ok: true, user };
  }, []);

  const updateUser = useCallback<AuthApi['updateUser']>(async (id, patch) => {
    const res = await updateOsUser(id, patch);
    if (res.ok) {
      const user = toUser(res.user);
      setState({ ...state, users: state.users.map((u) => (u.id === id ? user : u)) });
    }
  }, []);

  const updateSuperAdmin = useCallback<AuthApi['updateSuperAdmin']>(async (patch) => {
    const res = await updateOsUser(SUPER_ADMIN_ID, patch);
    if (!res.ok) return res;
    const user = toUser(res.user);
    setState({ ...state, users: state.users.map((u) => (u.id === SUPER_ADMIN_ID ? user : u)) });
    return { ok: true };
  }, []);

  const deleteUser = useCallback<AuthApi['deleteUser']>(async (id) => {
    const res = await deleteOsUser(id);
    if (res.ok) {
      setState({
        ...state,
        users: state.users.filter((u) => u.id !== id),
        currentUserId: state.currentUserId === id ? null : state.currentUserId,
      });
    }
  }, []);

  const setPermissions = useCallback<AuthApi['setPermissions']>(async (id, perms) => {
    // Optimistic — the grid updates instantly, the server persists in the bg.
    setState({
      ...state,
      users: state.users.map((u) => (u.id === id ? { ...u, permissions: perms } : u)),
    });
    await setOsPermissions(id, perms).catch(() => {
      /* best-effort; a later bootstrap reconciles */
    });
  }, []);

  const resetAllPermissionsTo = useCallback<AuthApi['resetAllPermissionsTo']>(async (id, mode) => {
    const next = mode === 'all' ? fullPermissions() : emptyPermissions();
    // Admin Console stays super-admin-only; never granted to a regular admin.
    next.admin_console = { view: false, edit: false, delete: false };
    setState({
      ...state,
      users: state.users.map((u) => (u.id === id ? { ...u, permissions: next } : u)),
    });
    await setOsPermissions(id, next).catch(() => {
      /* best-effort */
    });
  }, []);

  return {
    loading: snap.loading,
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

/**
 * Convenience hook for components that just need to know whether someone is
 * signed in. Triggers a re-render on auth changes via the underlying store.
 */
export function useIsSignedIn(): boolean {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  useEffect(() => {
    void ensureBootstrap();
  }, []);
  return state.currentUserId !== null;
}

/** Exposed so per-user storage keys (settings, session snapshot) can use the same id. */
export const SUPER_ADMIN_USER_ID = SUPER_ADMIN_ID;
