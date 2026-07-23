'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { backfillEmployeeAccounts } from '@/lib/server/employee-auth';

type Issued = { fullName: string; employeeCode: string; username: string; tempPassword: string };

/**
 * Settings → Team → "Portal accounts". A one-click way to give every active
 * employee a default portal login (username + temp password), shown once.
 *
 * Per-employee set/reset/revoke lives on each employee's OS-access tab; this
 * card is the bulk entry point. Styled with os.css variables — renders only
 * inside the (os) shell.
 */
export function EmployeeAccountsCard({ canManage }: { canManage: boolean }) {
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await backfillEmployeeAccounts();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.created.length === 0) {
        toast.info('Every active employee already has portal access.');
        return;
      }
      setIssued(res.created);
      toast.success(`Created ${res.created.length} portal login(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the accounts.');
    } finally {
      setBusy(false);
    }
  }

  function copyAll() {
    if (!issued) return;
    const text = issued
      .map((c) => `${c.fullName} (${c.employeeCode})\t${c.username}\t${c.tempPassword}`)
      .join('\n');
    void navigator.clipboard?.writeText(text);
    toast.success('Copied to clipboard.');
  }

  return (
    <div className="settings-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 220px' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Portal accounts</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          Give every active employee a default login for their self-service workspace (tasks, team,
          attendance). Each gets a username and a temporary password, shown once here for you to
          pass on. New hires get one automatically.
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {canManage ? (
          <button type="button" className="btn primary" disabled={busy} onClick={run}>
            {busy ? 'Creating…' : 'Create logins for everyone without one'}
          </button>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Ask an admin to create employee portal logins.
          </div>
        )}

        {issued ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--content-2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 12 }}>New logins — shown once</strong>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn" onClick={copyAll}>
                  Copy all
                </button>
                <button type="button" className="btn" onClick={() => setIssued(null)}>
                  Done
                </button>
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 8px' }}>
              These passwords are not stored in readable form and cannot be shown again. If one is
              lost, use “Reset password” on that employee’s OS-access tab.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 12, minWidth: 420 }}>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
