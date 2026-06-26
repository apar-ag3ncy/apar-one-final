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

/** Coerce a built-row value (Date / bool / null / object) into a PDF cell. */
function toPdfCell(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export function exportTableToPdf<TData>(table: Table<TData>, filename: string) {
  const { headers, rows } = buildRows(table);
  const pdfRows = rows.map((r) => {
    const out: Record<string, string | number> = {};
    for (const h of headers) out[h] = toPdfCell(r[h]);
    return out;
  });
  // Code-split @react-pdf/renderer; render off the click with its own error
  // handling so this stays a plain (non-async) call for the toolbar.
  void (async () => {
    try {
      const { downloadRowsAsPdf } = await import('@/lib/client/table-pdf');
      await downloadRowsAsPdf(pdfRows, headers, filename, 'Export');
    } catch (e) {
      console.error('PDF export failed', e);
      const { toast } = await import('sonner');
      toast.error('Could not generate the PDF.');
    }
  })();
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
