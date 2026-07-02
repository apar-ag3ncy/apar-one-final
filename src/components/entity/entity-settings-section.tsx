'use client';

// Settings tab body for the Client / Vendor / Employee / Project profile
// windows. Surfaces:
//   - Archive / Restore (capability-gated: archive_*, restore_*)
//   - Permanent delete (partner only, typed-name confirm)
//
// OS-native theme: uses CSS variables + `.btn` / `.pill` / `.os-modal*`
// classes so the look matches the surrounding window chrome (Rule 47 says
// shared components, but they may use surface-appropriate primitives —
// EntitySettingsSection is OS-only territory today).

import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/lib/client/use-current-user';
import { useEntityMutation } from '@/components/os/auth/entity-mutation-gate';
import { archiveClient, restoreClient, hardDeleteClient } from '@/lib/server/entities/clients';
import { archiveVendor, restoreVendor, hardDeleteVendor } from '@/lib/server/entities/vendors';
import {
  archiveEmployee,
  restoreEmployee,
  hardDeleteEmployee,
} from '@/lib/server/entities/employees';
import { archiveProject, restoreProject, hardDeleteProject } from '@/lib/server/entities/projects';

export type EntityKind = 'client' | 'vendor' | 'employee' | 'project';

const ARCHIVE_CAPS: Record<EntityKind, string> = {
  client: 'archive_client',
  vendor: 'archive_vendor',
  employee: 'archive_employee',
  project: 'archive_client', // projects reuse client capabilities — see projects.ts
};

const RESTORE_CAPS: Record<EntityKind, string> = {
  client: 'restore_client',
  vendor: 'restore_vendor',
  employee: 'restore_employee',
  project: 'restore_client',
};

async function callArchive(kind: EntityKind, id: string) {
  if (kind === 'client') return archiveClient(id);
  if (kind === 'vendor') return archiveVendor(id);
  if (kind === 'employee') return archiveEmployee(id);
  return archiveProject(id);
}

async function callRestore(kind: EntityKind, id: string) {
  if (kind === 'client') return restoreClient(id);
  if (kind === 'vendor') return restoreVendor(id);
  if (kind === 'employee') return restoreEmployee(id);
  return restoreProject(id);
}

async function callHardDelete(kind: EntityKind, id: string) {
  if (kind === 'client') return hardDeleteClient(id);
  if (kind === 'vendor') return hardDeleteVendor(id);
  if (kind === 'employee') return hardDeleteEmployee(id);
  return hardDeleteProject(id);
}

export type EntitySettingsSectionProps = {
  kind: EntityKind;
  entityId: string;
  entityName: string;
  isArchived: boolean;
  /** Called after archive/restore — caller should refetch the entity. */
  onChanged?: () => void;
  /**
   * Called after a successful HARD delete. The row no longer exists, so the
   * caller must NOT refetch it (that throws not_found) — close the window
   * instead. Falls back to `onChanged` when omitted.
   */
  onDeleted?: () => void;
};

export function EntitySettingsSection({
  kind,
  entityId,
  entityName,
  isArchived,
  onChanged,
  onDeleted,
}: EntitySettingsSectionProps) {
  const { user, hasCapability } = useCurrentUser();
  // OS read-only bridge: archive / restore / permanent-delete are all
  // destructive, so they hang off the OS "delete" grant. Permissive outside
  // the OS (no provider) — the real (app) surface still relies on the
  // capability + partner checks below and server-side enforcement.
  const { canDelete: osCanMutate } = useEntityMutation();
  const isPartner = user?.role === 'partner';
  const canArchive = osCanMutate && hasCapability(ARCHIVE_CAPS[kind]);
  const canRestore = osCanMutate && hasCapability(RESTORE_CAPS[kind]);
  const canHardDelete = osCanMutate && isPartner;

  const [busy, setBusy] = useState<'archive' | 'restore' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  async function handleArchive() {
    setBusy('archive');
    setError(null);
    try {
      await callArchive(kind, entityId);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    setError(null);
    try {
      await callRestore(kind, entityId);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleHardDelete() {
    if (confirmText.trim() !== entityName) {
      setError(`Type "${entityName}" exactly to confirm permanent deletion.`);
      return;
    }
    setBusy('delete');
    setError(null);
    try {
      await callHardDelete(kind, entityId);
      setDeleteOpen(false);
      // The row is gone — close the window rather than refetch (which would
      // throw not_found). Fall back to onChanged if no onDeleted handler.
      if (onDeleted) onDeleted();
      else onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
      <Card title="Lifecycle">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Archive hides this {kind} from active lists but preserves its history. Restore unhides it.
          Permanent delete removes the row entirely and refuses if any non-reversed transactions
          still reference it.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {isArchived ? (
            <button
              type="button"
              className="btn primary"
              onClick={handleRestore}
              disabled={!canRestore || busy !== null}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={handleArchive}
              disabled={!canArchive || busy !== null}
            >
              {busy === 'archive' ? 'Archiving…' : 'Archive'}
            </button>
          )}
          {canHardDelete ? (
            <button
              type="button"
              className="btn"
              onClick={() => setDeleteOpen(true)}
              disabled={busy !== null}
              style={{ color: 'var(--apar-red, #c33)' }}
            >
              Delete permanently…
            </button>
          ) : null}
        </div>
        {error ? (
          <p style={{ fontSize: 12, color: 'var(--text-error, #c33)', marginTop: 8 }}>{error}</p>
        ) : null}
        {!canArchive && !canRestore && !canHardDelete ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Your role doesn&apos;t have lifecycle capabilities for this {kind}.
          </p>
        ) : null}
      </Card>

      {deleteOpen ? (
        <DeleteModal
          entityName={entityName}
          kind={kind}
          confirmText={confirmText}
          onConfirmTextChange={(v) => {
            setConfirmText(v);
            if (error) setError(null);
          }}
          error={error}
          busy={busy === 'delete'}
          onCancel={() => {
            setDeleteOpen(false);
            setConfirmText('');
            setError(null);
          }}
          onConfirm={handleHardDelete}
        />
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--content-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          margin: 0,
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function DeleteModal({
  entityName,
  kind,
  confirmText,
  onConfirmTextChange,
  error,
  busy,
  onCancel,
  onConfirm,
}: {
  entityName: string;
  kind: EntityKind;
  confirmText: string;
  onConfirmTextChange: (v: string) => void;
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const canConfirm = !busy && confirmText.trim() === entityName;

  return (
    <div
      className="os-modal-overlay"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="os-modal" style={{ width: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="os-modal-head">
          <div className="font-display" style={{ fontSize: 18 }}>
            Permanently delete {entityName}?
          </div>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div
          style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            This cannot be undone. Refuses if any non-reversed transactions reference this {kind}.
            Type <strong style={{ color: 'var(--text)' }}>{entityName}</strong> below to confirm.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor="entity-settings-confirm"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Confirm name
            </label>
            <input
              id="entity-settings-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              placeholder={entityName}
              autoComplete="off"
              disabled={busy}
              style={{
                background: 'var(--content)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                padding: '8px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            {error ? (
              <p style={{ fontSize: 12, color: 'var(--text-error, #c33)', margin: 0 }}>{error}</p>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={onConfirm}
              disabled={!canConfirm}
              style={
                canConfirm
                  ? { background: 'var(--apar-red, #c33)', borderColor: 'var(--apar-red, #c33)' }
                  : undefined
              }
            >
              {busy ? 'Deleting…' : 'Permanently delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
