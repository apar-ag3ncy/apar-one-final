// Client-side export helpers for tabular data — ledgers, statements, reports.
//
// One implementation backs both CSV and XLSX via the `xlsx` lib that's
// already a dependency (the DataTable exporters use it too). Callers build
// plain row objects keyed by their column *label*; `headers` fixes the
// column order and which keys are emitted.
//
// Amounts should be passed as rupee numbers (see `paiseToRupees`) so Excel
// treats them as real numbers and can sum/format them.

import * as XLSX from 'xlsx';

export type ExportFormat = 'csv' | 'xlsx';

/** bigint paise → number rupees, for numeric spreadsheet columns. */
export function paiseToRupees(paise: bigint): number {
  // Loses precision above ~9e15 paise (~₹9e13) — irrelevant for INR ledgers.
  return Number(paise) / 100;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export an array of row objects as CSV or XLSX and trigger a download.
 *
 * @param rows     one object per data row, keyed by column label
 * @param headers  column labels in display order (also the object keys)
 * @param filename base filename; the correct extension is appended if absent
 * @param format   'csv' | 'xlsx'
 * @param sheetName worksheet name for XLSX (Excel caps this at 31 chars)
 */
export function exportRows(
  rows: ReadonlyArray<Record<string, string | number>>,
  headers: readonly string[],
  filename: string,
  format: ExportFormat,
  sheetName = 'Sheet1',
): void {
  const sheet = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[], {
    header: headers as string[],
  });

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
    return;
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** Slug-safe a label for use in a download filename. */
export function exportSlug(s: string): string {
  return s
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
