'use client';

import { useMemo, useState } from 'react';
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
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
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
            onCreate={(input) => {
              const result = createUser(input);
              if (result.ok) {
                setSelectedId(result.user.id);
                setCreating(false);
                return null;
              }
              return result.error;
            }}
          />
        )}
      </div>

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
                onClick={() => resetAllPermissionsTo(selected.id, 'all')}
              >
                <Icon name="check" size={13} /> Grant all
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => resetAllPermissionsTo(selected.id, 'none')}
              >
                <Icon name="close" size={13} /> Revoke all
              </button>
              <button
                type="button"
                className="btn"
                style={{ color: 'var(--apar-red)' }}
                onClick={() => {
                  if (window.confirm(`Delete ${selected.fullName}? This cannot be undone.`)) {
                    deleteUser(selected.id);
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
                    setPermissions(selected.id, next);
                  }}
                />
              </>
            )
          ) : (
            <div style={{ color: 'var(--text-muted)' }}>Pick a user from the left.</div>
          )}
        </div>
      </div>
    </>
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
  ) => { ok: true } | { ok: false; error: string };
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState(user.password);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFullName(user.fullName);
    setUsername(user.username);
    setPassword(user.password);
    setError(null);
  };

  const save = () => {
    const result = onSave({ fullName, username, password });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    setError(null);
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
            <button type="button" className="btn primary" onClick={save}>
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
  onSave: (patch: Partial<Pick<User, 'fullName' | 'password' | 'tone'>>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [password, setPassword] = useState(user.password);

  const reset = () => {
    setFullName(user.fullName);
    setPassword(user.password);
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
                onSave({ fullName, password });
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
      <div style={{ overflowX: 'auto' }}>
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
  onCreate: (input: { username: string; fullName: string; password: string }) => string | null;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const err = onCreate({ username, fullName, password });
        if (err) setError(err);
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
