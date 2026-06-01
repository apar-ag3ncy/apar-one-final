'use client';

import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import type { SortingState } from '@tanstack/react-table';

/**
 * Encode SortingState as `field` or `field:desc`, comma-joined for multi-sort.
 * Examples: "name", "amount:desc", "name,amount:desc".
 */
export function encodeSort(state: SortingState): string {
  return state
    .map((s) => (s.desc ? `${s.id}:desc` : s.id))
    .filter(Boolean)
    .join(',');
}

export function decodeSort(value: string | null): SortingState {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => {
      const [id, dir] = part.split(':');
      if (!id) return null;
      return { id, desc: dir === 'desc' };
    })
    .filter((x): x is { id: string; desc: boolean } => x !== null);
}

export type DataTableUrlState = {
  q: string;
  setQ: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  pageSize: number;
  setPageSize: (value: number) => void;
  sortString: string;
  setSortString: (value: string) => void;
};

export function useDataTableUrlState(defaults: { pageSize?: number } = {}): DataTableUrlState {
  const defaultPageSize = defaults.pageSize ?? 25;
  const [q, setQRaw] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPageRaw] = useQueryState('page', parseAsInteger.withDefault(1));
  const [pageSize, setPageSizeRaw] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(defaultPageSize),
  );
  const [sortString, setSortStringRaw] = useQueryState('sort', parseAsString.withDefault(''));

  return {
    q,
    setQ: (value: string) => {
      void setQRaw(value || null);
      void setPageRaw(null);
    },
    page,
    setPage: (value: number) => {
      void setPageRaw(value > 1 ? value : null);
    },
    pageSize,
    setPageSize: (value: number) => {
      void setPageSizeRaw(value === defaultPageSize ? null : value);
      void setPageRaw(null);
    },
    sortString,
    setSortString: (value: string) => {
      void setSortStringRaw(value || null);
      void setPageRaw(null);
    },
  };
}
