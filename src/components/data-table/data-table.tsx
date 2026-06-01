'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';
import {
  getUserTablePreference,
  saveUserTablePreference,
} from '@/lib/server/entities/table-preferences';
import { DataTableToolbar } from './data-table-toolbar';
import { DataTablePagination } from './data-table-pagination';
import { DataTableActionBar, type ActionBarAction } from './data-table-action-bar';
import { selectionColumn } from './selection-column';
import { decodeSort, encodeSort, useDataTableUrlState } from './url-state';

export type DataTableEmptyState = {
  icon?: React.ComponentProps<typeof EmptyState>['icon'];
  title: string;
  description?: string;
  action?: React.ReactNode;
};

type ServerPaginationProps = {
  /** Total row count from the backend (across all pages). */
  totalRows: number;
  /** Total page count. Required so TanStack can render the pagination footer. */
  pageCount: number;
};

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Filename root used for CSV/Excel export. */
  exportFilename?: string;
  /** Initial sort. URL state takes precedence if present. */
  initialSorting?: SortingState;
  /** Default page size if `pageSize=` is not in the URL. Default 25. */
  defaultPageSize?: number;
  /** Hide the toolbar entirely (use sparingly — every list page needs filter+export). */
  hideToolbar?: boolean;
  /** Hide just the search input inside the toolbar. */
  hideSearch?: boolean;
  /** Placeholder for the global search input. */
  searchPlaceholder?: string;
  /** Extra controls rendered on the toolbar's left side. */
  leadingToolbarActions?: React.ReactNode;
  /** Shown when data.length === 0. */
  emptyState?: DataTableEmptyState;
  /** Render a Skeleton in place of rows. */
  loading?: boolean;
  /** Row-click handler. Cells with stopPropagation override. */
  onRowClick?: (row: Row<TData>) => void;
  className?: string;

  /**
   * Server-mode pagination & sorting. Pass these together; data should already be paged/sorted.
   * If omitted, client-side pagination + sorting + filtering is used.
   */
  serverPagination?: ServerPaginationProps;
  manualSorting?: boolean;

  /**
   * SPEC-AMENDMENT-001 §6.2 — per-user table preferences.
   *
   * When set, column visibility is loaded from `user_table_preferences`
   * (keyed by this string) on mount, and saved on every change. Skip the
   * prop on tables that are inherently one-off (search results, modals).
   *
   * Examples: 'clients.list', 'vendors.list', 'client.<id>.projects'.
   */
  tableKey?: string;

  /**
   * SPEC-AMENDMENT-001 §2.2 — bulk select + floating action bar.
   *
   * Pass any non-empty array to enable: a checkbox column is prepended,
   * selection state is tracked, and the floating action bar appears
   * when ≥1 row is selected. Actions are caller-provided so each entity
   * type can render its appropriate verbs (Archive / Reverse / Delete).
   *
   * Set `bulkActions={[]}` to enable selection without any actions
   * (rare — usually you want at least one verb).
   */
  bulkActions?: readonly ActionBarAction<TData>[];
  /** Singular/plural noun for the action bar's row-count label. */
  bulkEntityLabel?: { singular: string; plural: string };
};

const DEFAULT_PAGE_SIZE = 25;

export function DataTable<TData, TValue>({
  columns,
  data,
  exportFilename = 'export',
  initialSorting = [],
  defaultPageSize = DEFAULT_PAGE_SIZE,
  hideToolbar,
  hideSearch,
  searchPlaceholder,
  leadingToolbarActions,
  emptyState,
  loading,
  onRowClick,
  className,
  serverPagination,
  manualSorting,
  tableKey,
  bulkActions,
  bulkEntityLabel,
}: DataTableProps<TData, TValue>) {
  const url = useDataTableUrlState({ pageSize: defaultPageSize });
  const selectionEnabled = bulkActions !== undefined;
  const effectiveColumns = React.useMemo(() => {
    if (!selectionEnabled) return columns;
    return [selectionColumn<TData>(), ...columns] as ColumnDef<TData, TValue>[];
  }, [columns, selectionEnabled]);

  const sorting = React.useMemo<SortingState>(() => {
    const fromUrl = decodeSort(url.sortString);
    return fromUrl.length > 0 ? fromUrl : initialSorting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.sortString]);

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    url.setSortString(encodeSort(next));
  };

  const pagination: PaginationState = {
    pageIndex: Math.max(0, url.page - 1),
    pageSize: url.pageSize,
  };
  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater;
    if (next.pageSize !== url.pageSize) url.setPageSize(next.pageSize);
    if (next.pageIndex !== pagination.pageIndex) url.setPage(next.pageIndex + 1);
  };

  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const prefsLoadedRef = React.useRef(false);

  // Load saved column visibility for this user + tableKey on mount.
  React.useEffect(() => {
    if (!tableKey) {
      prefsLoadedRef.current = true;
      return;
    }
    let cancelled = false;
    getUserTablePreference(tableKey)
      .then((pref) => {
        if (cancelled) return;
        if (pref?.visibleColumns) {
          const visibility: VisibilityState = {};
          for (const colId of pref.visibleColumns) {
            visibility[colId] = true;
          }
          setColumnVisibility(visibility);
        }
        prefsLoadedRef.current = true;
      })
      .catch(() => {
        // Silently ignore — fall back to defaults.
        prefsLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [tableKey]);

  const onGlobalFilterChange: OnChangeFn<string> = (updater) => {
    const next = typeof updater === 'function' ? updater(url.q) : (updater as string);
    url.setQ(next ?? '');
  };

  const table = useReactTable<TData>({
    data,
    columns: effectiveColumns,
    state: {
      sorting,
      pagination,
      columnVisibility,
      columnFilters,
      globalFilter: url.q,
      rowSelection,
    },
    onSortingChange,
    onPaginationChange,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: serverPagination ? undefined : getPaginationRowModel(),
    manualPagination: !!serverPagination,
    manualSorting: !!manualSorting,
    pageCount: serverPagination?.pageCount,
    rowCount: serverPagination?.totalRows,
    enableMultiSort: true,
    enableSortingRemoval: true,
    enableColumnFilters: true,
    enableRowSelection: selectionEnabled,
    autoResetPageIndex: false,
  });

  // Debounced save of column visibility back to user_table_preferences.
  React.useEffect(() => {
    if (!tableKey || !prefsLoadedRef.current) return;
    const visibleCols = table
      .getAllLeafColumns()
      .filter((c) => c.getIsVisible() && c.id !== 'select' && c.id !== 'actions')
      .map((c) => c.id);
    const handle = setTimeout(() => {
      saveUserTablePreference({ tableKey, visibleColumns: visibleCols }).catch(() => {
        // Silently ignore — UI continues with local state.
      });
    }, 800);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, columnVisibility]);

  const rows = table.getRowModel().rows;
  const hasData = rows.length > 0;
  const noData = !loading && data.length === 0;
  const totalsDisplay = serverPagination?.totalRows;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {hideToolbar ? null : (
        <DataTableToolbar
          table={table}
          exportFilename={exportFilename}
          hideSearch={hideSearch}
          searchPlaceholder={searchPlaceholder}
          leadingActions={leadingToolbarActions}
          tableKey={tableKey}
        />
      )}

      {noData && emptyState ? (
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
          action={emptyState.action}
        />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan} className="h-10 px-3">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: Math.min(url.pageSize, 6) }).map((_, idx) => (
                  <TableRow key={`skeleton-${idx}`}>
                    {table.getVisibleLeafColumns().map((col) => (
                      <TableCell key={col.id} className="px-3 py-3">
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : hasData ? (
                rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={cn(onRowClick && 'cursor-pointer')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="text-muted-foreground h-32 text-center text-sm"
                  >
                    No matching rows.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {noData && emptyState ? null : (
        <DataTablePagination table={table} totalRows={totalsDisplay} />
      )}

      {selectionEnabled && bulkActions && bulkActions.length > 0 ? (
        <DataTableActionBar table={table} actions={bulkActions} entityLabel={bulkEntityLabel} />
      ) : null}
    </div>
  );
}
