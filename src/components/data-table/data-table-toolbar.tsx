'use client';

import { DownloadIcon, BookmarkPlusIcon, SearchIcon, XIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { exportTableToCsv, exportTableToXlsx } from './exporters';
import { DataTableViewOptions } from './data-table-view-options';

type Props<TData> = {
  table: Table<TData>;
  /** Filename root used for CSV/Excel exports. ".csv" / ".xlsx" appended automatically. */
  exportFilename: string;
  /** Hide the global search input. */
  hideSearch?: boolean;
  /** Placeholder for the global search input. */
  searchPlaceholder?: string;
  /** Extra controls rendered to the left of the column toggle. */
  leadingActions?: React.ReactNode;
  /** Forwarded to <DataTableViewOptions> to enable "Reset to default" against user_table_preferences. */
  tableKey?: string;
};

export function DataTableToolbar<TData>({
  table,
  exportFilename,
  hideSearch,
  searchPlaceholder = 'Search…',
  leadingActions,
  tableKey,
}: Props<TData>) {
  const globalFilter = table.getState().globalFilter as string | undefined;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        {hideSearch ? null : (
          <div className="relative w-full max-w-sm">
            <SearchIcon
              className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={globalFilter ?? ''}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-9"
            />
            {globalFilter ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
                onClick={() => table.setGlobalFilter('')}
              >
                <XIcon className="size-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        )}
        {leadingActions}
      </div>
      <div className="flex items-center gap-2">
        <DataTableViewOptions table={table} tableKey={tableKey} />
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() => {
            // TODO(backend): persist the current filter/sort/columns to `saved_views` once that
            // table exists. For now the action is informational.
            toast.info('Saved views land once the backend ships the saved_views table.');
          }}
        >
          <BookmarkPlusIcon className="size-4" aria-hidden />
          Save view
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-2">
              <DownloadIcon className="size-4" aria-hidden />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => exportTableToCsv(table, exportFilename)}>
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportTableToXlsx(table, exportFilename)}>
              Excel (.xlsx)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
