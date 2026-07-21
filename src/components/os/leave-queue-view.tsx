'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  decidePendingLeave,
  listPendingLeave,
  type PendingLeaveRow,
} from '@/lib/server/entities/leave-queue';

/**
 * OS Employees → "Leave requests". Every pending leave, with the ones whose
 * employee has NO manager appointed flagged — those fall to admin, and nobody
 * else will action them.
 *
 * Styled with the os.css variables/classes, so it only renders correctly inside
 * the (os) shell.
 */

const KIND_LABEL: Record<string, string> = {
  earned: 'Earned',
  casual: 'Casual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  comp_off: 'Comp-off',
  maternity: 'Maternity',
  paternity: 'Paternity',
};

const PAID_KINDS = new Set(['earned', 'casual', 'sick', 'comp_off']);

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function LeaveQueueView({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<PendingLeaveRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [paid, setPaid] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    listPendingLeave()
      .then((r) => {
        setRows(r);
        // Default "approve as paid" to whether the kind is a paid one.
        setPaid((prev) => {
          const next = { ...prev };
          for (const row of r) if (!(row.id in next)) next[row.id] = PAID_KINDS.has(row.kind);
          return next;
        });
      })
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Could not load leave requests.');
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  async function decide(row: PendingLeaveRow, accept: boolean) {
    setBusyId(row.id);
    try {
      const res = await decidePendingLeave({
        id: row.id,
        accept,
        managerNote: notes[row.id] ?? '',
        isPaid: accept ? (paid[row.id] ?? true) : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(accept ? 'Leave approved.' : 'Leave rejected.');
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading leave requests…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No pending leave requests.
      </div>
    );
  }

  const unassigned = rows.filter((r) => r.hasNoManager).length;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
        {rows.length} pending
        {unassigned > 0
          ? ` · ${unassigned} from teammates with no manager appointed, so they are yours to decide`
          : ''}
        .
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => {
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                background: 'var(--surface)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {r.employeeName}{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {r.employeeCode}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {KIND_LABEL[r.kind] ?? r.kind} · {r.days} day{r.days === '1' ? '' : 's'} ·{' '}
                    {r.fromDate === r.toDate
                      ? fmt(r.fromDate)
                      : `${fmt(r.fromDate)} → ${fmt(r.toDate)}`}
                  </div>
                  {r.notes ? (
                    <div style={{ fontSize: 12, marginTop: 6 }}>“{r.notes}”</div>
                  ) : null}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                  {r.hasNoManager ? (
                    <span style={{ color: 'var(--accent, #E63A1F)', fontWeight: 600 }}>
                      No manager · admin decides
                    </span>
                  ) : (
                    <>Manager: {r.managerName}</>
                  )}
                </div>
              </div>

              {canManage ? (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <input
                    placeholder="Reply to the employee (optional)"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                    disabled={busy}
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11.5 }}>
                    <input
                      type="checkbox"
                      checked={paid[r.id] ?? true}
                      onChange={(e) => setPaid((p) => ({ ...p, [r.id]: e.target.checked }))}
                      disabled={busy}
                    />
                    Paid
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => decide(r, true)}
                  >
                    Approve
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => decide(r, false)}>
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
