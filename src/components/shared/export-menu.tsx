'use client';

// Small PDF / Excel export dropdown shared by the report screens. Mirrors the
// DataTable toolbar's Export menu so the two surfaces feel consistent. The
// parent owns row-building and calls `exportRows`; this is pure UI.

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ExportFormat } from '@/lib/client/export-rows';

export function ExportMenu({
  onExport,
  disabled,
  label = 'Export',
}: {
  onExport: (format: ExportFormat) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport('pdf')}>PDF (.pdf)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport('xlsx')}>Excel (.xlsx)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
