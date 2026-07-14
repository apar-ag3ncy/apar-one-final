'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RotateCcwIcon } from 'lucide-react';

import { Icon } from '../icons';
import { TypeToConfirmDialog } from './os-modal-kit';
import { SortHeader, sortRows, useTableSort, type SortValue } from './table-sort';
import {
  listTrash,
  listTrashLog,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  type TrashItemRow,
  type TrashLogRow,
  type TrashKind,
} from '@/lib/server/entities/trash';

/**
 * Settings → Trash (admin-only). Aggregates every archived / soft-deleted row
 * across the principal directories + the Office app + document links, with
 * per-row Restore and Permanent delete, plus a deletion log. Client-side
 * fetched via the read actions; each write reloads the list. Same OS chrome as
 * the rest of Settings (.table / .btn / .pill / .settings-row).
 */

const KIND_LABEL: Record<TrashKind, string> = {
  client: 'Client',
  vendor: 'Vendor',
  employee: 'Employee',
  project: 'Project',
  office_expense: 'Office expense',
  office_expense_category: 'Expense category',
  salary_payment: 'Salary payment',
  salary_structure: 'Salary update',
  bonus: 'Bonus / perk',
  document: 'Document',
};

/** Clickable columns of the trashed-items table. One shared sort state applies
 *  within each kind section (rows stay grouped by their section). Accessors
 *  return raw values (label strings, ISO deleted-at). */
type TrashSortKey = 'type' | 'item' | 'reason' | 'deleted';

const TRASH_SORT_ACCESSORS: Record<TrashSortKey, (i: TrashItemRow) => SortValue> = {
  type: (i) => KIND_LABEL[i.kind],
  item: (i) => i.label,
  reason: (i) => i.reason,
  deleted: (i) => i.deletedAt,
};

/** Order + headings for the per-app sections in the Trash. */
const SECTION_ORDER: readonly TrashKind[] = [
  'client',
  'vendor',
  'employee',
  'project',
  'office_expense',
  'office_expense_category',
  'salary_payment',
  'salary_structure',
  'bonus',
  'document',
];
const SECTION_LABEL: Record<TrashKind, string> = {
  client: 'Clients',
  vendor: 'Vendors',
  employee: 'Employees',
  project: 'Projects',
  office_expense: 'Office — expenses',
  office_expense_category: 'Office — expense categories',
  salary_payment: 'Payroll — salary payments',
  salary_structure: 'Payroll — salary updates',
  bonus: 'Payroll — bonuses & perks',
  document: 'Documents',
};

/** kind:id → the key used to track which row is busy / pending confirm. */
function rowKey(item: TrashItemRow): string {
  return `${item.kind}:${item.id}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TrashPane() {
  const [items, setItems] = useState<readonly TrashItemRow[] | null>(null);
  const [log, setLog] = useState<readonly TrashLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Documents get a stronger gate than the inline "Delete?" confirm: the file
  // is unrecoverable once purged, so the user must type "delete" first.
  const [typeConfirm, setTypeConfirm] = useState<TrashItemRow | null>(null);
  const { sort, toggle } = useTableSort<TrashSortKey>();

  const reload = useCallback(() => {
    Promise.all([listTrash(), listTrashLog()])
      .then(([trash, trashLog]) => {
        setItems(trash);
        setLog(trashLog);
        setLoadError(null);
      })
      .catch(() => setLoadError('Could not load Trash. You may not have permission.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listTrash(), listTrashLog()])
      .then(([trash, trashLog]) => {
        if (cancelled) return;
        setItems(trash);
        setLog(trashLog);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load Trash. You may not have permission.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const restore = async (item: TrashItemRow) => {
    const key = rowKey(item);
    setBusyKey(key);
    try {
      await restoreTrashItem({ kind: item.kind, id: item.id });
      toast.success(`Restored ${item.label}.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore this item.');
    } finally {
      setBusyKey(null);
    }
  };

  const purge = async (item: TrashItemRow) => {
    const key = rowKey(item);
    setBusyKey(key);
    setConfirmKey(null);
    try {
      await permanentlyDeleteTrashItem({ kind: item.kind, id: item.id });
      toast.success(`Permanently deleted ${item.label}.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not permanently delete this item.');
    } finally {
      setBusyKey(null);
      setTypeConfirm(null);
    }
  };

  if (loadError) {
    return <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{loadError}</div>;
  }
  if (items === null || log === null) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Loading Trash…</div>
    );
  }

  return (
    <div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="label">Trash</div>
          <div className="desc">
            Deleted clients, vendors, teammates, projects, office expenses and documents, grouped by
            app. Restore brings an item back; permanent delete cannot be undone. Anything left here
            for more than 30 days is disposed of automatically — only its log line remains.
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 18px 8px' }}>
        {items.length === 0 ? (
          <div style={{ padding: '18px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Trash is empty — nothing deleted.
          </div>
        ) : (
          SECTION_ORDER.filter((k) => items.some((i) => i.kind === k)).map((sectionKind) => (
            <div key={sectionKind} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  padding: '8px 0 6px',
                }}
              >
                {SECTION_LABEL[sectionKind]} ({items.filter((i) => i.kind === sectionKind).length})
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader
                      label="Type"
                      sortKey="type"
                      sort={sort}
                      onSort={toggle}
                      style={{ width: 130 }}
                    />
                    <SortHeader label="Item" sortKey="item" sort={sort} onSort={toggle} />
                    <SortHeader
                      label="Reason"
                      sortKey="reason"
                      sort={sort}
                      onSort={toggle}
                      style={{ width: 90 }}
                    />
                    <SortHeader
                      label="Deleted"
                      sortKey="deleted"
                      sort={sort}
                      onSort={toggle}
                      style={{ width: 170 }}
                    />
                    <th style={{ width: 200 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortRows(
                    items.filter((i) => i.kind === sectionKind),
                    sort,
                    TRASH_SORT_ACCESSORS,
                  ).map((item) => {
                    const key = rowKey(item);
                    const busy = busyKey === key;
                    const confirming = confirmKey === key;
                    return (
                      <tr key={key} className="row-clickable">
                        <td>
                          <span className={`pill ${item.reason === 'archived' ? 'amber' : ''}`}>
                            {KIND_LABEL[item.kind]}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{item.label}</div>
                          {item.sublabel ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {item.sublabel}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                          {item.reason}
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{formatWhen(item.deletedAt)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {confirming ? (
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                              }}
                            >
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Delete?
                              </span>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  background: 'var(--apar-red-deep)',
                                  borderColor: 'transparent',
                                  color: '#fff',
                                }}
                                disabled={busy}
                                onClick={() => void purge(item)}
                              >
                                Yes, delete
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                onClick={() => setConfirmKey(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn"
                                disabled={busy}
                                title="Restore this item"
                                onClick={() => void restore(item)}
                              >
                                <RotateCcwIcon size={12} aria-hidden />
                                Restore
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{ color: 'var(--apar-red)' }}
                                disabled={busy}
                                title="Permanently delete — cannot be undone"
                                onClick={() =>
                                  item.kind === 'document'
                                    ? setTypeConfirm(item)
                                    : setConfirmKey(key)
                                }
                              >
                                <Icon name="trash" size={12} />
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {typeConfirm ? (
        <TypeToConfirmDialog
          title="Permanently delete document?"
          message={
            <>
              <strong>{typeConfirm.label}</strong> will be deleted for good — the file is removed
              from storage and cannot be recovered.
            </>
          }
          busy={busyKey === rowKey(typeConfirm)}
          onConfirm={() => void purge(typeConfirm)}
          onCancel={() => setTypeConfirm(null)}
        />
      ) : null}

      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="label">Deletion log</div>
          <div className="desc">Recent archive, restore and permanent-delete activity.</div>
        </div>
      </div>
      <div style={{ padding: '4px 18px 18px' }}>
        {log.length === 0 ? (
          <div style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            No deletion activity recorded yet.
          </div>
        ) : (
          log.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                padding: '9px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ minWidth: 0, flex: 1, fontSize: 12.5 }}>{entry.summary}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {entry.actorName ?? 'System'} · {formatWhen(entry.at)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
