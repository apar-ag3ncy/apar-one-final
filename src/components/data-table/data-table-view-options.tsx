'use client';

import { Settings2Icon } from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { resetUserTablePreference } from '@/lib/server/entities/table-preferences';

export type DataTableViewOptionsProps<TData> = {
  table: Table<TData>;
  /** When set, the "Reset to default" item is enabled and clears the saved pref. */
  tableKey?: string;
};

export function DataTableViewOptions<TData>({ table, tableKey }: DataTableViewOptionsProps<TData>) {
  const hideable = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.id !== 'select' && column.id !== 'actions');

  if (hideable.length === 0) return null;

  const allVisible = hideable.every((c) => c.getIsVisible());

  function showAll() {
    for (const col of hideable) {
      if (!col.getIsVisible()) col.toggleVisibility(true);
    }
  }

  function hideAll() {
    for (const col of hideable) {
      if (col.getIsVisible()) col.toggleVisibility(false);
    }
  }

  async function resetToDefault() {
    if (!tableKey) return;
    try {
      await resetUserTablePreference(tableKey);
    } catch {
      // Silently ignore — local state still resets below.
    }
    for (const col of hideable) {
      if (!col.getIsVisible()) col.toggleVisibility(true);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <Settings2Icon className="size-4" aria-hidden />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => {
          const def = column.columnDef;
          const meta = (def.meta ?? {}) as { exportLabel?: string };
          const label =
            meta.exportLabel ?? (typeof def.header === 'string' ? def.header : column.id);
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            showAll();
          }}
          disabled={allVisible}
        >
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            hideAll();
          }}
        >
          Hide all
        </DropdownMenuItem>
        {tableKey ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void resetToDefault();
            }}
          >
            Reset to default
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
