'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  backfillPortalAccounts,
  createPortalAccount,
  listPortalAccounts,
  resetPortalPassword,
  revokePortalAccount,
  setPortalRole,
  type PortalAccountRow,
} from '@/lib/server/portal/admin';

type Issued = { fullName: string; employeeCode: string; username: string; tempPassword: string };

/**
 * Settings → Team → "Portal accounts".
 *
 * Provisioning for the employee portal: who can sign in, and who is a manager
 * (managers review leave for their whole reporting subtree).
 *
 * Styled with the os.css variables/classes, so it only renders correctly
 * inside the (os) shell — which is where Settings lives.
 */
export function PortalAccountsCard({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<PortalAccountRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const withoutAccess = rows?.filter((r) => !r.username).length ?? 0;

  async function runBackfill() {
    setBackfilling(true);
    try {
      const res = await backfillPortalAccounts();
      if (res.created.length === 0) {
        toast.info('Everyone already has a portal account.');
        return;
      }
      setIssued(res.created);
      toast.success(`Created ${res.created.length} portal account(s).`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the accounts.');
    } finally {
      setBackfilling(false);
    }
  }

  function copyIssued() {
    if (!issued) return;
    const text = issued
      .map((c) => `${c.fullName} (${c.employeeCode})\t${c.username}\t${c.tempPassword}`)
      .join('\n');
    void navigator.clipboard?.writeText(text);
    toast.success('Copied to clipboard.');
  }

  const load = useCallback(() => {
    listPortalAccounts()
      .then(setRows)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Could not load portal accounts.');
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setBusyId(id);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? 'That did not work.');
        return false;
      }
      toast.success(ok);
      load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not work.');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function startCreate(employeeId: string, fullName: string) {
    setCreatingFor(employeeId);
    // Sensible default: first name, lowercased.
    setUsername(fullName.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '');
    setPassword('');
  }

  async function submitCreate(employeeId: string) {
    const created = await run(
      employeeId,
      () => createPortalAccount({ employeeId, username, password }),
      'Portal account created.',
    );
    if (created) {
      setCreatingFor(null);
      setUsername('');
      setPassword('');
    }
  }

  return (
    <div className="settings-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 220px' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Portal accounts</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Who can sign in to the employee portal, and who reviews leave. A manager sees pending
          requests from everyone below them in the Org tree.
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {canManage && withoutAccess > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="btn primary" disabled={backfilling} onClick={runBackfill}>
              {backfilling
                ? 'Creating…'
                : `Create accounts for all ${withoutAccess} without one`}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Each gets a username and a temporary password, shown once here for you to pass on.
            </div>
          </div>
        ) : null}

        {issued ? (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-2, rgba(0,0,0,0.03))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 12 }}>
                New sign-ins — shown once
              </strong>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn" onClick={copyIssued}>
                  Copy all
                </button>
                <button type="button" className="btn" onClick={() => setIssued(null)}>
                  Done
                </button>
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 8px' }}>
              These passwords are not stored in readable form and cannot be shown again. If one is
              lost, use “Reset password” on that row.
            </div>
            <table className="table" style={{ fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Username</th>
                  <th>Temporary password</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((c) => (
                  <tr key={c.username}>
                    <td>
                      {c.fullName}{' '}
                      <span style={{ color: 'var(--text-muted)' }}>{c.employeeCode}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>{c.username}</td>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>{c.tempPassword}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {rows === null ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No active employees.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th style={{ textAlign: 'right' }}>Access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const busy = busyId === r.employeeId;
                  return (
                    <tr key={r.employeeId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.fullName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {r.employeeCode}
                          {r.designation ? ` · ${r.designation}` : ''}
                        </div>
                      </td>
                      <td>
                        {r.username ? (
                          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                            @{r.username}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>No access</span>
                        )}
                      </td>
                      <td>
                        <select
                          value={r.portalRole}
                          disabled={!canManage || busy}
                          onChange={(e) =>
                            run(
                              r.employeeId,
                              () =>
                                setPortalRole({
                                  employeeId: r.employeeId,
                                  portalRole: e.target.value as 'member' | 'manager',
                                }),
                              'Portal role updated.',
                            )
                          }
                        >
                          <option value="member">Team member</option>
                          <option value="manager">Manager</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.username ? (
                          <>
                            <button
                              type="button"
                              className="btn"
                              disabled={!canManage || busy}
                              onClick={() => {
                                const next = window.prompt(
                                  `New portal password for ${r.fullName} (min 12 characters):`,
                                );
                                if (!next) return;
                                run(
                                  r.employeeId,
                                  () =>
                                    resetPortalPassword({
                                      employeeId: r.employeeId,
                                      password: next,
                                    }),
                                  'Password reset.',
                                );
                              }}
                            >
                              Reset password
                            </button>{' '}
                            <button
                              type="button"
                              className="btn danger"
                              disabled={!canManage || busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Revoke portal access for ${r.fullName}? They will be signed out.`,
                                  )
                                )
                                  return;
                                run(
                                  r.employeeId,
                                  () => revokePortalAccount({ employeeId: r.employeeId }),
                                  'Portal access revoked.',
                                );
                              }}
                            >
                              Revoke
                            </button>
                          </>
                        ) : creatingFor === r.employeeId ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              gap: 6,
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                            }}
                          >
                            <input
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              placeholder="username"
                              style={{ width: 120 }}
                              disabled={busy}
                            />
                            <input
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="password (12+)"
                              style={{ width: 140 }}
                              disabled={busy}
                            />
                            <button
                              type="button"
                              className="btn primary"
                              disabled={busy}
                              onClick={() => submitCreate(r.employeeId)}
                            >
                              Create
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() => setCreatingFor(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn"
                            disabled={!canManage || busy}
                            onClick={() => startCreate(r.employeeId, r.fullName)}
                          >
                            Give access
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
