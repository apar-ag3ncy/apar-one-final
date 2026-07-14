'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { changeVaultPassword, getVaultStatus, setupVault } from '@/lib/server/settings/vault';
import { Icon } from '../icons';
import { initials } from '../format';
import { APPS } from '../data';
import { PERMISSIONED_APPS, type AppPermission, type Permissions, type User } from './types';
import { useAuth } from './store';

const ACTIONS: readonly (keyof AppPermission)[] = ['view', 'edit', 'delete'];

/**
 * Admin Console — visible only to the operator (the always-on super admin).
 *
 * Left sidebar: user list (operator pinned at top, non-deletable).
 * Right pane: identity card (editable for the operator themselves), then a
 * permission grid (8 apps × view/edit/delete). For admins the grid is fully
 * interactive; for the operator's own row the grid is read-only because they
 * always have full access.
 */
export function AdminConsole() {
  const auth = useAuth();
  const {
    allUsers,
    currentUser,
    createUser,
    deleteUser,
    setPermissions,
    resetAllPermissionsTo,
    updateUser,
    updateSuperAdmin,
  } = auth;

  const [selectedId, setSelectedId] = useState<string>(() => allUsers[0]?.id ?? 'super-admin');
  const [creating, setCreating] = useState(false);

  const selected = useMemo<User | undefined>(
    () => allUsers.find((u) => u.id === selectedId) ?? allUsers[0],
    [allUsers, selectedId],
  );

  if (currentUser?.role !== 'super_admin') {
    return (
      <div className="main">
        <div className="main-header">
          <h2>Admin</h2>
        </div>
        <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          You do not have access to the Admin Console.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sidebar admin-sidebar">
        <h4>Users</h4>
        {allUsers.map((u) => (
          <div
            key={u.id}
            className={`side-item admin-user ${u.id === selectedId ? 'active' : ''}`}
            onClick={() => setSelectedId(u.id)}
          >
            <span
              className="avatar"
              style={{ width: 22, height: 22, fontSize: 9, background: u.tone }}
              aria-hidden
            >
              {initials(u.fullName)}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {u.fullName}
              </span>
              <span
                style={{
                  fontSize: 10,
                  opacity: 0.75,
                }}
              >
                @{u.username}
              </span>
            </span>
          </div>
        ))}
        <button
          type="button"
          className="btn primary"
          style={{ marginTop: 12, justifyContent: 'center' }}
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={13} /> New user
        </button>
        {creating && (
          <NewUserForm
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const result = await createUser(input);
              if (result.ok) {
                setSelectedId(result.user.id);
                setCreating(false);
                return null;
              }
              return result.error;
            }}
          />
        )}

        <h4 style={{ marginTop: 18 }}>System</h4>
        <div
          className={`side-item admin-user ${selectedId === VAULT_SECTION ? 'active' : ''}`}
          onClick={() => setSelectedId(VAULT_SECTION)}
        >
          <span
            className="avatar"
            style={{ width: 22, height: 22, fontSize: 9, background: 'var(--apar-red-deep)' }}
            aria-hidden
          >
            <Icon name="shield" size={11} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Vault password</span>
            <span style={{ fontSize: 10, opacity: 0.75 }}>Create or change the master key</span>
          </span>
        </div>
      </div>

      {selectedId === VAULT_SECTION ? (
        <div className="main">
          <div className="main-header">
            <h2>Vault password</h2>
            <span className="sub">the one key that encrypts everything in the vault</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            <VaultPasswordPane />
          </div>
        </div>
      ) : (
        <div className="main">
          <div className="main-header">
            <h2>Admin</h2>
            <span className="sub">
              {allUsers.length} {allUsers.length === 1 ? 'user' : 'users'}
            </span>
            <div className="grow" />
            {selected && selected.role !== 'super_admin' ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void resetAllPermissionsTo(selected.id, 'all')}
                >
                  <Icon name="check" size={13} /> Grant all
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void resetAllPermissionsTo(selected.id, 'none')}
                >
                  <Icon name="close" size={13} /> Revoke all
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ color: 'var(--apar-red)' }}
                  onClick={() => {
                    if (window.confirm(`Delete ${selected.fullName}? This cannot be undone.`)) {
                      void deleteUser(selected.id);
                    }
                  }}
                >
                  <Icon name="trash" size={13} /> Delete user
                </button>
              </>
            ) : null}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {selected ? (
              selected.role === 'super_admin' ? (
                <OperatorIdentityCard user={selected} onSave={updateSuperAdmin} />
              ) : (
                <>
                  <RegularIdentityCard
                    user={selected}
                    onSave={(patch) => updateUser(selected.id, patch)}
                  />
                  <PermissionGrid
                    user={selected}
                    onToggle={(appId, action, value) => {
                      const next: Permissions = {
                        ...selected.permissions,
                        [appId]: {
                          ...selected.permissions[appId],
                          [action]: value,
                        },
                      };
                      void setPermissions(selected.id, next);
                    }}
                  />
                </>
              )
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>Pick a user from the left.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Sidebar selection sentinel for the Vault password section (not a user id). */
const VAULT_SECTION = '__vault__';

/* -------------------------------------------------------------------------- */
/* Vault password — create when unconfigured, change when configured          */
/* -------------------------------------------------------------------------- */

function VaultPasswordPane() {
  const [phase, setPhase] = useState<'loading' | 'denied' | 'error' | 'create' | 'change'>(
    'loading',
  );
  const [attempt, setAttempt] = useState(0);
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVaultStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s.ok) {
          setPhase(s.denied ? 'denied' : 'error');
          return;
        }
        setPhase(s.configured ? 'change' : 'create');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function submit() {
    setError(null);
    if (next.length < 8) {
      setError('The vault password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    if (phase === 'change' && !current) {
      setError('Enter the current vault password.');
      return;
    }
    startTransition(async () => {
      const result =
        phase === 'create' ? await setupVault(next) : await changeVaultPassword(current, next);
      if (result.ok) {
        toast.success(
          phase === 'create'
            ? 'Vault created. Unlock it with your new vault password.'
            : 'Vault password changed. Every entry was re-encrypted under the new key.',
        );
        setCurrent('');
        setNext('');
        setConfirm('');
        if (phase === 'create') setPhase('change');
      } else {
        setError(result.message);
        // Create can fail because someone else set the vault up first
        // (concurrent setup loses via onConflictDoNothing) — re-probe so the
        // pane flips to the change form instead of a dead-end create form.
        if (phase === 'create') setAttempt((n) => n + 1);
      }
    });
  }

  if (phase === 'loading') {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Checking the vault…</div>;
  }
  if (phase === 'denied') {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        You don&apos;t have access to manage the vault.
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        Could not load the vault.{' '}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setPhase('loading');
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const creating = phase === 'create';
  return (
    <div style={{ maxWidth: 440 }}>
      <p
        style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}
      >
        {creating
          ? 'The vault has no password yet. Pick one — everything stored in the vault is encrypted with it, and there is no recovery if it is lost.'
          : 'Changing the password re-encrypts every vault entry under a fresh key. The current password is required — without it the entries cannot be decrypted, so there is no recovery if it is lost.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!creating && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Current vault password</span>
            <input
              className="admin-input"
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={pending}
            />
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="admin-field-label">
            {creating ? 'Vault password' : 'New vault password'}
          </span>
          <input
            className="admin-input"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={pending}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="admin-field-label">
            Confirm {creating ? 'password' : 'new password'}
          </span>
          <input
            className="admin-input"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={pending}
          />
        </label>
        {error ? (
          <div role="alert" style={{ color: 'var(--apar-red)', fontSize: 12 }}>
            {error}
          </div>
        ) : null}
        <div>
          <button type="button" className="btn primary" onClick={submit} disabled={pending}>
            {pending
              ? creating
                ? 'Creating…'
                : 'Changing…'
              : creating
                ? 'Create vault password'
                : 'Change vault password'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Operator identity card — editable                                          */
/* -------------------------------------------------------------------------- */

function OperatorIdentityCard({
  user,
  onSave,
}: {
  user: User;
  onSave: (
    patch: Partial<Pick<User, 'fullName' | 'username' | 'password'>>,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [username, setUsername] = useState(user.username);
  // Password is never sent to the client — leave blank to keep the current one.
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFullName(user.fullName);
    setUsername(user.username);
    setPassword('');
    setError(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await onSave({ fullName, username, ...(password ? { password } : {}) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setPassword('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          className="avatar"
          style={{ width: 48, height: 48, fontSize: 16, background: user.tone, borderRadius: 12 }}
          aria-hidden
        >
          {initials(user.fullName)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 22, lineHeight: 1.1 }}>
            {user.fullName}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
            @{user.username} · created {new Date(user.createdAt).toLocaleDateString('en-IN')}
          </div>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit profile
          </button>
        )}
      </div>

      {editing && (
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Display name</span>
            <input
              className="admin-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Username</span>
            <input
              className="admin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Password</span>
            <input
              className="admin-input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
            />
          </label>
          {error ? (
            <div
              role="alert"
              style={{
                gridColumn: '1 / -1',
                color: 'var(--apar-red)',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Regular admin identity card                                                */
/* -------------------------------------------------------------------------- */

function RegularIdentityCard({
  user,
  onSave,
}: {
  user: User;
  onSave: (patch: Partial<Pick<User, 'fullName' | 'password' | 'tone'>>) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  // Password is never sent to the client — leave blank to keep the current one.
  const [password, setPassword] = useState('');

  const reset = () => {
    setFullName(user.fullName);
    setPassword('');
  };

  return (
    <div
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          className="avatar"
          style={{ width: 48, height: 48, fontSize: 16, background: user.tone, borderRadius: 12 }}
          aria-hidden
        >
          {initials(user.fullName)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{ fontSize: 22, lineHeight: 1.1 }}>
            {user.fullName}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
            @{user.username} · created {new Date(user.createdAt).toLocaleDateString('en-IN')}
          </div>
        </div>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void onSave({ fullName, ...(password ? { password } : {}) });
                setEditing(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {editing && (
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Display name</span>
            <input
              className="admin-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="admin-field-label">Password</span>
            <input
              className="admin-input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Permission grid                                                            */
/* -------------------------------------------------------------------------- */

function PermissionGrid({
  user,
  onToggle,
}: {
  user: User;
  onToggle: (
    appId: (typeof PERMISSIONED_APPS)[number],
    action: keyof AppPermission,
    value: boolean,
  ) => void;
}) {
  return (
    <div
      style={{
        background: 'var(--content)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div style={{ fontWeight: 600 }}>Permissions</div>
      </div>
      <div style={{ overflowX: 'auto', padding: '0 16px' }}>
        <table className="table" style={{ fontSize: 13, minWidth: 460 }}>
          <thead>
            <tr>
              <th>App</th>
              {ACTIONS.map((a) => (
                <th key={a} style={{ textAlign: 'center', width: 96 }}>
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONED_APPS.map((id) => {
              const app = APPS.find((a) => a.id === id);
              if (!app) return null;
              return (
                <tr key={id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        className="avatar"
                        style={{
                          width: 28,
                          height: 28,
                          background: 'var(--apar-red-soft)',
                          color: 'var(--apar-red)',
                          borderRadius: 8,
                        }}
                      >
                        <Icon name={app.icon} size={14} />
                      </span>
                      <span style={{ fontWeight: 500 }}>{app.name}</span>
                    </div>
                  </td>
                  {ACTIONS.map((a) => {
                    const on = user.permissions[id]?.[a] ?? false;
                    return (
                      <td key={a} style={{ textAlign: 'center' }}>
                        <div
                          className={`toggle ${on ? 'on' : ''}`}
                          style={{ display: 'inline-block', cursor: 'pointer' }}
                          onClick={() => onToggle(id, a, !on)}
                          role="switch"
                          aria-checked={on}
                          aria-label={`${a} ${app.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* New user form                                                              */
/* -------------------------------------------------------------------------- */

function NewUserForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: {
    username: string;
    fullName: string;
    password: string;
  }) => Promise<string | null>;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        void (async () => {
          try {
            const err = await onCreate({ username, fullName, password });
            if (err) setError(err);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the user.');
          } finally {
            setSubmitting(false);
          }
        })();
      }}
      style={{
        marginTop: 12,
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--content)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12 }}>New user</div>
      <input
        className="admin-input"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Full name"
        autoFocus
      />
      <input
        className="admin-input"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="off"
      />
      <input
        className="admin-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="new-password"
      />
      {error ? (
        <div style={{ color: 'var(--apar-red)', fontSize: 11.5 }} role="alert">
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" className="btn primary" style={{ flex: 1, justifyContent: 'center' }}>
          Create
        </button>
        <button
          type="button"
          className="btn"
          onClick={onCancel}
          style={{ justifyContent: 'center' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
