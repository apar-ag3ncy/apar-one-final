'use client';

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, EyeOffIcon } from 'lucide-react';
import type { Column } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type Props<TData, TValue> = {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
};

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: Props<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <span className={cn('text-muted-foreground text-xs font-medium', className)}>{title}</span>
    );
  }

  const sorted = column.getIsSorted();
  const SortIcon =
    sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ChevronsUpDownIcon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('-ml-2 h-8 gap-1.5 px-2 text-xs font-medium', className)}
        >
          <span>{title}</span>
          <SortIcon className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => column.toggleSorting(false)}>
          <ArrowUpIcon className="text-muted-foreground size-3.5" aria-hidden />
          Sort ascending
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => column.toggleSorting(true)}>
          <ArrowDownIcon className="text-muted-foreground size-3.5" aria-hidden />
          Sort descending
        </DropdownMenuItem>
        {sorted ? (
          <DropdownMenuItem onSelect={() => column.clearSorting()}>
            <ChevronsUpDownIcon className="text-muted-foreground size-3.5" aria-hidden />
            Clear sort
          </DropdownMenuItem>
        ) : null}
        {column.getCanHide() ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => column.toggleVisibility(false)}>
              <EyeOffIcon className="text-muted-foreground size-3.5" aria-hidden />
              Hide column
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
