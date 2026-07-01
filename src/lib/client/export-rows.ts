// Client-side export helpers for tabular data — ledgers, statements, reports.
//
// One implementation backs both PDF and XLSX. XLSX uses the `xlsx` lib that's
// already a dependency; PDF defers to `@react-pdf/renderer` via a dynamic
// import (see `./table-pdf`) so that heavy lib never lands in a page bundle
// unless someone actually exports a PDF. Callers build plain row objects keyed
// by their column *label*; `headers` fixes the column order and which keys are
// emitted.
//
// Amounts should be passed as rupee numbers (see `paiseToRupees`) so Excel
// treats them as real numbers and can sum/format them.

import * as XLSX from 'xlsx';

export type ExportFormat = 'pdf' | 'xlsx';

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
 * Export an array of row objects as PDF or XLSX and trigger a download.
 *
 * Synchronous-looking by design: the PDF path kicks off its own async work
 * (dynamic import + render) with self-contained error handling, so the ~12
 * call sites can keep calling this without awaiting or threading promises.
 *
 * @param rows     one object per data row, keyed by column label
 * @param headers  column labels in display order (also the object keys)
 * @param filename base filename; the correct extension is appended if absent
 * @param format   'pdf' | 'xlsx'
 * @param sheetName worksheet name for XLSX (Excel caps this at 31 chars); also
 *                  used as the PDF title
 * @param opts.columnFormats optional Excel number-format code per column label,
 *                  e.g. `{ Balance: '+#,##0.00;-#,##0.00;0.00' }` to force a
 *                  leading +/- sign while keeping the cell numeric (XLSX only).
 */
export function exportRows(
  rows: ReadonlyArray<Record<string, string | number>>,
  headers: readonly string[],
  filename: string,
  format: ExportFormat,
  sheetName = 'Sheet1',
  opts: { columnFormats?: Record<string, string> } = {},
): void {
  if (format === 'pdf') {
    // Code-split @react-pdf/renderer; render off the click. Self-contained
    // error handling keeps the void signature (no floating promise upstream).
    void (async () => {
      try {
        const { downloadRowsAsPdf } = await import('./table-pdf');
        await downloadRowsAsPdf(rows, headers, filename, sheetName);
      } catch (e) {
        console.error('PDF export failed', e);
        const { toast } = await import('sonner');
        toast.error('Could not generate the PDF.');
      }
    })();
    return;
  }

  const sheet = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[], {
    header: headers as string[],
  });

  // Apply per-column number formats (e.g. a signed Balance). json_to_sheet
  // writes numeric cells as {t:'n'}; setting `.z` makes Excel render the sign
  // without turning the value into text (so it still sums).
  if (opts.columnFormats) {
    for (const [label, fmt] of Object.entries(opts.columnFormats)) {
      const colIdx = headers.indexOf(label);
      if (colIdx < 0) continue;
      for (let r = 1; r <= rows.length; r++) {
        const addr = XLSX.utils.encode_cell({ c: colIdx, r });
        const cell = sheet[addr] as { t?: string; z?: string } | undefined;
        if (cell && cell.t === 'n') cell.z = fmt;
      }
    }
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
