'use client';

// A self-contained, iOS-style month calendar. No react-day-picker — every day
// is a plain <button> so taps are dead-reliable, and it drills days → months →
// years so any date (a DOB, an old bill) is two taps away. Styled with inline
// styles + the shared --calendar-accent token so it looks identical in the OS
// shell and the app shell without depending on any Tailwind utility being built.

import * as React from 'react';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const ACCENT = 'var(--calendar-accent, #e63a1f)';
const ACCENT_FG = 'var(--calendar-accent-foreground, #fff)';
const MUTED = 'var(--text-muted, var(--muted-foreground, #8a8a8a))';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export type IosCalendarProps = {
  value: Date | null;
  onSelect: (d: Date) => void;
  /** Inclusive selection bounds. */
  min?: Date;
  max?: Date;
  /** Year the year-picker centres on when there's no value yet. */
  defaultMonth?: Date;
};

export function IosCalendar({ value, onSelect, min, max, defaultMonth }: IosCalendarProps) {
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const initial = value ?? defaultMonth ?? today;
  // The displayed month (any day within it).
  const [view, setView] = React.useState<Date>(new Date(initial.getFullYear(), initial.getMonth(), 1));
  // Open at the MONTHS level: pick a month → days, or tap the year → years.
  const [mode, setMode] = React.useState<'days' | 'months' | 'years'>('months');
  // The popover remounts this component every time it opens, so `view`'s
  // initializer already reflects the current value — no sync effect needed.

  const minD = min ? startOfDay(min) : null;
  const maxD = max ? startOfDay(max) : null;
  const dayDisabled = React.useCallback(
    (d: Date) => (minD && d < minD) || (maxD && d > maxD) || false,
    [minD, maxD],
  );

  const year = view.getFullYear();
  const month = view.getMonth();

  // 6×7 grid starting on the Sunday on/before the 1st.
  const cells = React.useMemo(() => {
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }, [year, month]);

  const shiftMonth = (delta: number) => setView(new Date(year, month + delta, 1));
  const shiftYear = (delta: number) => setView(new Date(year + delta, month, 1));

  // Year picker shows a 12-year page.
  const yearPageStart = year - (((year % 12) + 12) % 12);
  const years = Array.from({ length: 12 }, (_, i) => yearPageStart + i);

  const navBtn: React.CSSProperties = {
    width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
    fontSize: 17, lineHeight: 1, padding: 0,
  };

  return (
    <div style={{ width: 260, userSelect: 'none', color: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 2px 8px' }}>
        <button
          type="button"
          // Drill up a level: days → months, months → years (tap the year),
          // years → back to months.
          onClick={() => setMode(mode === 'months' ? 'years' : 'months')}
          style={{
            flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit',
            cursor: 'pointer', fontSize: 15, fontWeight: 600, padding: '4px 6px', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
          aria-label="Switch month or year"
        >
          {mode === 'days'
            ? `${MONTHS_LONG[month]} ${year}`
            : mode === 'months'
              ? String(year)
              : `${years[0]} – ${years[11]}`}
          <span style={{ color: ACCENT, fontSize: 11 }}>▾</span>
        </button>
        <button
          type="button"
          style={navBtn}
          aria-label="Previous"
          onClick={() => (mode === 'days' ? shiftMonth(-1) : mode === 'months' ? shiftYear(-1) : setView(new Date(year - 12, month, 1)))}
        >
          ‹
        </button>
        <button
          type="button"
          style={navBtn}
          aria-label="Next"
          onClick={() => (mode === 'days' ? shiftMonth(1) : mode === 'months' ? shiftYear(1) : setView(new Date(year + 12, month, 1)))}
        >
          ›
        </button>
      </div>

      {mode === 'days' && (
        <>
          {/* Weekday header */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: MUTED, padding: '2px 0' }}>
                {w}
              </div>
            ))}
          </div>
          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === month;
              const isSelected = sameDay(d, value);
              const isToday = sameDay(d, today);
              const disabled = dayDisabled(d);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  data-day={`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`}
                  data-selected={isSelected || undefined}
                  onClick={() => onSelect(startOfDay(d))}
                  style={{
                    aspectRatio: '1 / 1',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: isToday && !isSelected ? `1px solid ${ACCENT}` : '1px solid transparent',
                    borderRadius: 9999,
                    background: isSelected ? ACCENT : 'transparent',
                    color: isSelected ? ACCENT_FG : isToday ? ACCENT : inMonth ? 'inherit' : MUTED,
                    fontWeight: isSelected || isToday ? 600 : 400,
                    fontSize: 13,
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.3 : 1,
                    padding: 0,
                    transition: 'background 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !disabled) e.currentTarget.style.background = 'color-mix(in oklab, currentColor 10%, transparent)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </>
      )}

      {mode === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '4px 0' }}>
          {MONTHS_SHORT.map((m, i) => {
            const isSel = i === month && year === view.getFullYear();
            return (
              <button
                key={m}
                type="button"
                onClick={() => { setView(new Date(year, i, 1)); setMode('days'); }}
                style={{
                  padding: '10px 0', borderRadius: 10, border: '1px solid transparent',
                  background: isSel ? ACCENT : 'transparent', color: isSel ? ACCENT_FG : 'inherit',
                  fontSize: 13, fontWeight: isSel ? 600 : 400, cursor: 'pointer',
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'years' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: '4px 0' }}>
          {years.map((y) => {
            const isSel = y === year;
            return (
              <button
                key={y}
                type="button"
                onClick={() => { setView(new Date(y, month, 1)); setMode('months'); }}
                style={{
                  padding: '10px 0', borderRadius: 10, border: '1px solid transparent',
                  background: isSel ? ACCENT : 'transparent', color: isSel ? ACCENT_FG : 'inherit',
                  fontSize: 13, fontWeight: isSel ? 600 : 400, cursor: 'pointer',
                }}
              >
                {y}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
