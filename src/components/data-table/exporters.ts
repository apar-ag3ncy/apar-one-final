import * as XLSX from 'xlsx';
import type { Cell, Row, Table } from '@tanstack/react-table';

type CellValueOptions = {
  /** Treat bigint paise columns as rupees in export. Default true. */
  paiseAsRupees?: boolean;
};

function getExportableValue<TData>(
  cell: Cell<TData, unknown>,
  opts: CellValueOptions = {},
): string | number | boolean | Date | null {
  const raw = cell.getValue();
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'bigint') {
    if (opts.paiseAsRupees ?? true) {
      // bigint paise → number rupees. Loses precision above ~9e15 — fine for INR.
      return Number(raw) / 100;
    }
    return raw.toString();
  }
  if (raw instanceof Date) return raw;
  if (typeof raw === 'object') return JSON.stringify(raw);
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw;
  }
  return String(raw);
}

function buildRows<TData>(table: Table<TData>) {
  const headers: string[] = [];
  const columnIds: string[] = [];
  for (const header of table.getVisibleLeafColumns()) {
    if (header.id === 'select' || header.id === 'actions') continue;
    columnIds.push(header.id);
    const meta = (header.columnDef.meta ?? {}) as { exportLabel?: string };
    const def = header.columnDef;
    const label = meta.exportLabel ?? (typeof def.header === 'string' ? def.header : header.id);
    headers.push(label);
  }
  const rows = table.getSortedRowModel().rows.map((row: Row<TData>) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columnIds.length; i++) {
      const id = columnIds[i]!;
      const label = headers[i]!;
      const cell = row.getAllCells().find((c) => c.column.id === id);
      obj[label] = cell ? getExportableValue(cell) : null;
    }
    return obj;
  });
  return { headers, rows };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTableToCsv<TData>(table: Table<TData>, filename: string) {
  const { headers, rows } = buildRows(table);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportTableToXlsx<TData>(table: Table<TData>, filename: string) {
  const { headers, rows } = buildRows(table);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Data');
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
