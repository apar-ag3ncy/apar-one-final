'use client';

// OS Attendance app — top-level dock app. Matrix view of every active
// employee × every day in the selected month. Defaults to 'present' on
// weekdays and 'weekly_off' on Sundays; the DB only stores exceptions.
// Click any cell to open a dropdown of all statuses; right-click clears
// (returns to default). Month picker navigates the full history.

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  clearAttendance,
  listAttendanceMatrix,
  markAttendance,
  markAttendanceBulk,
  type AttendanceStatus,
  type EmployeeAttendanceMatrixRow,
} from '@/lib/server/entities/attendance';
import { defaultStatusForDate } from '@/lib/attendance-defaults';
import { osActions } from '@/lib/os/store';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  work_from_home: 'WFH',
  absent: 'Absent',
  half_day: 'Half-day',
  on_leave: 'On leave',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: '#2e8f5a',
  work_from_home: '#3f6fb0',
  absent: '#c34a2c',
  half_day: '#c98a2e',
  on_leave: '#7a4eaf',
  weekly_off: '#5a5a5a',
  holiday: '#8a6a2d',
};

const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P',
  work_from_home: 'W',
  absent: 'A',
  half_day: 'H',
  on_leave: 'L',
  weekly_off: '·',
  holiday: 'X',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function monthDateRange(year: number, month: number): { from: string; to: string; days: number } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(last)}`,
    days: last,
  };
}

function isoFor(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const STATUS_ORDER: readonly AttendanceStatus[] = [
  'present',
  'work_from_home',
  'half_day',
  'on_leave',
  'absent',
  'weekly_off',
  'holiday',
];

type PickerState = {
  employeeId: string;
  employeeName: string;
  date: string;
  current: AttendanceStatus;
  isOverride: boolean;
  x: number;
  y: number;
};

export function AttendanceApp() {
  const today = new Date();
  const todayIso = useMemo(
    () => `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [rows, setRows] = useState<readonly EmployeeAttendanceMatrixRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [bulkDate, setBulkDate] = useState<string>(todayIso);

  const range = useMemo(() => monthDateRange(year, month), [year, month]);
  const monthLabel = useMemo(
    () =>
      new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [year, month],
  );

  async function reload() {
    try {
      const data = await listAttendanceMatrix({ fromDate: range.from, toDate: range.to });
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load attendance');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listAttendanceMatrix({ fromDate: range.from, toDate: range.to })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Load failed');
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  }

  function openPicker(
    e: React.MouseEvent<HTMLElement>,
    employeeId: string,
    employeeName: string,
    date: string,
    current: AttendanceStatus,
    isOverride: boolean,
  ) {
    if (busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Approx height: header + 7 status rows (+1 reset row) + paddings.
    const approxHeight = 36 + STATUS_ORDER.length * 28 + (isOverride ? 36 : 0) + 12;
    const flipUp = rect.bottom + approxHeight + 8 > window.innerHeight;
    const flipLeft = rect.left + 220 > window.innerWidth;
    setPicker({
      employeeId,
      employeeName,
      date,
      current,
      isOverride,
      x: flipLeft ? Math.max(8, window.innerWidth - 228) : rect.left,
      y: flipUp ? Math.max(8, rect.top - approxHeight - 4) : rect.bottom + 4,
    });
  }

  async function pickStatus(value: AttendanceStatus) {
    if (!picker) return;
    const { employeeId, date } = picker;
    setPicker(null);
    setBusy(true);
    try {
      await markAttendance({ employeeId, date, status: value });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark');
    } finally {
      setBusy(false);
    }
  }

  async function pickClear() {
    if (!picker) return;
    const { employeeId, date } = picker;
    setPicker(null);
    setBusy(true);
    try {
      await clearAttendance({ employeeId, date });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!picker) return;
    function onAway(e: MouseEvent) {
      // React synthetic stopPropagation doesn't stop native document
      // listeners (React 17+ listens at the root, below document), so we
      // must check the click target directly against the popup.
      if (pickerRef.current && pickerRef.current.contains(e.target as Node)) {
        return;
      }
      setPicker(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPicker(null);
    }
    function onResize() {
      setPicker(null);
    }
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [picker]);

  async function cellClear(employeeId: string, date: string) {
    setBusy(true);
    try {
      await clearAttendance({ employeeId, date });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear');
    } finally {
      setBusy(false);
    }
  }

  async function markAllOnDate(status: AttendanceStatus) {
    if (!rows) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bulkDate)) {
      toast.error('Pick a valid date first.');
      return;
    }
    setBusy(true);
    try {
      const pairs = rows.map((r) => ({ employeeId: r.employeeId, date: bulkDate }));
      await markAttendanceBulk({ pairs, status });
      const human = new Date(`${bulkDate}T00:00:00Z`).toLocaleDateString('en-IN', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        timeZone: 'UTC',
      });
      toast.success(`Marked ${pairs.length} as ${STATUS_LABEL[status]} on ${human}.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk mark failed');
    } finally {
      setBusy(false);
    }
  }

  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => i + 1), [range.days]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="main-header">
        <h2>Attendance</h2>
        <span className="sub">{rows ? `${rows.length} active employees` : 'Loading…'}</span>
        <div className="grow" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={() => shiftMonth(-1)}
            disabled={busy}
            aria-label="Previous month"
          >
            ←
          </button>
          <span
            className="font-display"
            style={{
              fontSize: 14,
              minWidth: 140,
              textAlign: 'center',
              padding: '4px 10px',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {monthLabel}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => shiftMonth(1)}
            disabled={busy}
            aria-label="Next month"
          >
            →
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setYear(today.getFullYear());
              setMonth(today.getMonth() + 1);
            }}
            disabled={busy}
          >
            Today
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>
          Bulk mark for:
        </span>
        <input
          type="date"
          value={bulkDate}
          onChange={(e) => setBulkDate(e.target.value)}
          disabled={busy}
          aria-label="Date for bulk attendance"
          style={{
            background: 'var(--content)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            padding: '4px 8px',
            fontSize: 12,
            fontFamily: 'inherit',
            colorScheme: 'dark light',
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || bulkDate === todayIso}
          onClick={() => setBulkDate(todayIso)}
          title="Reset to today"
        >
          Today
        </button>
        {(['present', 'work_from_home', 'holiday'] as AttendanceStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            disabled={busy || !rows}
            onClick={() => markAllOnDate(s)}
            style={{
              background: STATUS_COLOR[s],
              color: '#fff',
              borderColor: STATUS_COLOR[s],
            }}
          >
            Mark all {STATUS_LABEL[s]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <Legend />
      </div>

      {/* Matrix */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {rows === null ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>
            No active employees.
          </p>
        ) : (
          <table
            className="table"
            style={{
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontSize: 11,
              tableLayout: 'fixed',
              width: 'max-content',
              minWidth: '100%',
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    position: 'sticky',
                    left: 0,
                    background: 'var(--content-2)',
                    zIndex: 2,
                    minWidth: 180,
                    textAlign: 'left',
                    padding: '6px 10px',
                    borderRight: '1px solid var(--border)',
                  }}
                >
                  Employee
                </th>
                {days.map((d) => {
                  const iso = isoFor(year, month, d);
                  const def = defaultStatusForDate(iso);
                  const isToday = iso === todayIso;
                  return (
                    <th
                      key={d}
                      style={{
                        width: 30,
                        textAlign: 'center',
                        padding: '6px 0',
                        color: isToday
                          ? 'var(--apar-red)'
                          : def === 'weekly_off'
                            ? STATUS_COLOR.weekly_off
                            : undefined,
                        background: 'var(--content-2)',
                        fontWeight: isToday ? 700 : undefined,
                        borderLeft: isToday ? '2px solid var(--apar-red)' : undefined,
                        borderRight: isToday ? '2px solid var(--apar-red)' : undefined,
                        borderTop: isToday ? '2px solid var(--apar-red)' : undefined,
                      }}
                      title={`${new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                      })}${isToday ? ' (today)' : ''}`}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: 'var(--content)',
                      zIndex: 1,
                      padding: '6px 10px',
                      borderRight: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        osActions.openWindow({
                          app: 'employees',
                          entityId: r.employeeId,
                          position: 'beside-focused',
                        })
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{r.fullName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {r.designation ?? '—'}
                        {r.department ? ` · ${r.department}` : ''}
                      </div>
                    </button>
                  </td>
                  {days.map((d) => {
                    const iso = isoFor(year, month, d);
                    const status = r.overrides[iso] ?? defaultStatusForDate(iso);
                    const isOverride = r.overrides[iso] !== undefined;
                    const isOpen =
                      picker !== null && picker.employeeId === r.employeeId && picker.date === iso;
                    const isToday = iso === todayIso;
                    return (
                      <td
                        key={d}
                        className={`att-cell ${isOverride ? 'is-override' : 'is-default'}${
                          isOpen ? ' is-open' : ''
                        }`}
                        onClick={(e) =>
                          openPicker(e, r.employeeId, r.fullName, iso, status, isOverride)
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (isOverride) void cellClear(r.employeeId, iso);
                        }}
                        title={`${r.fullName} · ${new Date(`${iso}T00:00:00Z`).toLocaleDateString(
                          'en-IN',
                          {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short',
                          },
                        )}${isToday ? ' (today)' : ''}\n${STATUS_LABEL[status]}${isOverride ? ' (override)' : ' (default)'}${busy ? '' : ' — click to change'}`}
                        style={{
                          width: 30,
                          height: 28,
                          textAlign: 'center',
                          padding: 0,
                          cursor: busy ? 'wait' : 'pointer',
                          background: STATUS_COLOR[status],
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 10,
                          borderRight: isToday
                            ? '2px solid var(--apar-red)'
                            : '1px solid var(--border)',
                          borderLeft: isToday ? '2px solid var(--apar-red)' : undefined,
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {STATUS_SHORT[status]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Themed status picker — reuses the OS menubar dropdown look. */}
      {picker && (
        <div
          ref={pickerRef}
          className="mb-dropdown"
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: picker.y,
            left: picker.x,
            minWidth: 220,
            zIndex: 1000,
          }}
        >
          <div
            className="row"
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              cursor: 'default',
            }}
          >
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{picker.employeeName}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              {new Date(`${picker.date}T00:00:00Z`).toLocaleDateString('en-IN', {
                weekday: 'long',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </span>
          </div>
          <hr />
          {STATUS_ORDER.map((s) => {
            const selected = s === picker.current;
            return (
              <div
                key={s}
                className="row live"
                role="menuitem"
                onClick={() => void pickStatus(s)}
                style={{ alignItems: 'center' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: STATUS_COLOR[s],
                    }}
                  />
                  {STATUS_LABEL[s]}
                </span>
                {selected ? (
                  <span
                    style={{
                      color: 'var(--text-dim)',
                      fontFamily: 'var(--os-font)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 11,
                    }}
                  >
                    ✓
                  </span>
                ) : null}
              </div>
            );
          })}
          {picker.isOverride && (
            <>
              <hr />
              <div
                className="row live"
                role="menuitem"
                onClick={() => void pickClear()}
                style={{ alignItems: 'center' }}
              >
                <span>Reset to default</span>
                <span
                  style={{
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--os-font)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 11,
                  }}
                >
                  ⇧⌫
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const items: AttendanceStatus[] = [
    'present',
    'work_from_home',
    'half_day',
    'on_leave',
    'absent',
    'weekly_off',
    'holiday',
  ];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      <span style={{ marginRight: 4 }}>Legend:</span>
      {items.map((s) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 3,
              background: STATUS_COLOR[s],
            }}
          />
          {STATUS_LABEL[s]}
        </span>
      ))}
      <span style={{ marginLeft: 6, color: 'var(--text-dim, var(--text-muted))' }}>
        Faded = default · solid = override · click to pick status · right-click to reset
      </span>
    </div>
  );
}
