'use client';

// Shared click-to-sort primitive for the OS `.table` windows. One hook holds
// the {key, dir} state and toggles asc → desc → asc on repeated clicks of the
// same header; `sortRows` orders a row array by a per-key value accessor
// (string / number / bigint / Date-ISO, nulls last); `SortHeader` is a drop-in
// `<th>` that shows the active ▲/▼ and a faint ⇅ on the rest.
//
// Only for FLAT, homogeneous row lists. Do NOT use on grouped statements with
// subtotal/section rows (balance sheet, trial balance, P&L) — sorting would
// scramble the groups.

import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortState<K extends string> = { key: K | null; dir: SortDir };

/** Value a row contributes for a given sort key. `null`/`undefined` sort last. */
export type SortValue = string | number | bigint | null | undefined;

export function useTableSort<K extends string>(initial?: {
  key: K;
  dir?: SortDir;
}): {
  sort: SortState<K>;
  toggle: (key: K) => void;
  setSort: (s: SortState<K>) => void;
} {
  const [sort, setSort] = useState<SortState<K>>({
    key: initial?.key ?? null,
    dir: initial?.dir ?? 'asc',
  });
  const toggle = (key: K) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  return { sort, toggle, setSort };
}

function compare(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last (in ascending)
  if (b == null) return -1;
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const d = BigInt(a as string | number | bigint) - BigInt(b as string | number | bigint);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Returns a new array ordered by the active sort. When no key is active the
 * input order is preserved (stable). Nulls always sort last regardless of dir.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  accessors: Record<K, (row: T) => SortValue>,
): T[] {
  if (!sort.key) return [...rows];
  const acc = accessors[sort.key];
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((ra, rb) => {
    const av = acc(ra);
    const bv = acc(rb);
    // Keep nulls last on BOTH directions.
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    return compare(av, bv) * dir;
  });
}

/** Convenience hook: memoised sorted rows. */
export function useSortedRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  accessors: Record<K, (row: T) => SortValue>,
): T[] {
  return useMemo(() => sortRows(rows, sort, accessors), [rows, sort, accessors]);
}

/** A clickable `<th>` that drives {@link useTableSort}. */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  style,
}: {
  label: React.ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right' | 'center';
  style?: React.CSSProperties;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title="Click to sort"
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          flexDirection: align === 'right' ? 'row-reverse' : 'row',
          justifyContent:
            align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        }}
      >
        {label}
        <span
          aria-hidden
          style={{ fontSize: 8.5, lineHeight: 1, opacity: active ? 0.9 : 0.28, letterSpacing: -1 }}
        >
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );
}
