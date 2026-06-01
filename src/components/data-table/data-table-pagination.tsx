'use client';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function DataTablePagination<TData>({
  table,
  totalRows,
}: {
  table: Table<TData>;
  /** When provided, displayed alongside the page indicator (useful in server-pagination mode). */
  totalRows?: number;
}) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = table.getPageCount();
  const rowCount = totalRows ?? table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <div className="text-muted-foreground text-sm">
        {rowCount.toLocaleString('en-IN')} row{rowCount === 1 ? '' : 's'}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-muted-foreground text-sm">
          Page {pageIndex + 1} of {Math.max(pageCount, 1)}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.setPageIndex(0)}
          >
            <ChevronsLeftIcon className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRightIcon className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Last page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.setPageIndex(Math.max(pageCount - 1, 0))}
          >
            <ChevronsRightIcon className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
