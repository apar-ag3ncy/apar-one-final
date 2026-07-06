'use client';

// Client-side "rows → PDF table" backing the shared export helpers. Kept in
// its own module so `@react-pdf/renderer` (heavy) is only pulled into a page's
// bundle when the user actually exports a PDF — callers reach it through a
// dynamic `import()` inside `exportRows` / the DataTable exporters, never a
// static import.

import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';

/** A cell value the table can render. Callers coerce richer types to these. */
export type PdfCell = string | number;

// @react-pdf wraps cell text at whitespace, but a long *unbreakable* token
// (reference/invoice numbers, account codes, emails, a run-on party name)
// otherwise overflows its cell and overlaps the next column. A hyphenation
// callback lets us insert break opportunities inside such tokens so they wrap
// within the cell instead. Short/normal words are returned untouched (single
// chunk = no internal break). Registered once at module load — this module is
// only pulled in when a table PDF is actually exported, so it never touches the
// server-rendered invoice/voucher PDFs.
Font.registerHyphenationCallback((word) =>
  word.length > 14 ? (word.match(/.{1,12}/g) ?? [word]) : [word],
);

const styles = StyleSheet.create({
  page: { paddingVertical: 28, paddingHorizontal: 26, fontSize: 8, color: '#1a1a1a' },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 0.75,
    borderBottomColor: '#e2662a',
  },
  brandMark: { height: 26, maxWidth: 130, objectFit: 'contain' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: '#c8c8c8' },
  row: { flexDirection: 'row' },
  headerRow: { backgroundColor: '#eef0f2' },
  zebra: { backgroundColor: '#f7f8f9' },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: '#c8c8c8',
  },
  headerCell: { fontFamily: 'Helvetica-Bold' },
  cellRight: { textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 26,
    right: 26,
    fontSize: 7,
    color: '#9a9a9a',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

function fmtCell(v: PdfCell | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v)
      ? v.toLocaleString('en-IN')
      : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(v);
}

function TableDoc({
  title,
  headers,
  rows,
}: {
  title?: string;
  headers: readonly string[];
  rows: ReadonlyArray<Record<string, PdfCell>>;
}) {
  // Wide tables breathe better on landscape A4.
  const landscape = headers.length > 6;

  // Content-aware column widths (percent, always summing to 100%): each column
  // gets a share proportional to its widest value, so text-heavy columns
  // (particulars, party, account) get room to wrap while short numeric columns
  // (debit/credit, dates, codes) stay narrow — nothing is starved into
  // overflowing its neighbour. Weights are clamped so one very long value can't
  // swallow the table, and a sample cap keeps big ledgers fast.
  const colStyles = React.useMemo(() => {
    const SAMPLE = 400;
    const lim = Math.min(rows.length, SAMPLE);
    const weights = headers.map((h) => {
      let w = String(h).length;
      for (let i = 0; i < lim; i++) {
        const len = fmtCell(rows[i]![h]).length;
        if (len > w) w = len;
      }
      // Floor keeps tiny columns legible; ceiling stops a run-on cell from
      // dominating (its text just wraps to more lines instead).
      return Math.max(5, Math.min(34, w));
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => ({ width: `${((w / total) * 100).toFixed(3)}%` }));
  }, [headers, rows]);

  return (
    <Document>
      <Page size="A4" orientation={landscape ? 'landscape' : 'portrait'} style={styles.page}>
        <View style={styles.brandBar}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={APAR_ORANGE_MARK_DATA_URI} style={styles.brandMark} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
        </View>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]} fixed>
            {headers.map((h, i) => (
              <Text key={i} style={[styles.cell, styles.headerCell, colStyles[i]!]}>
                {h}
              </Text>
            ))}
          </View>
          {rows.map((r, ri) => (
            <View
              key={ri}
              style={ri % 2 === 1 ? [styles.row, styles.zebra] : styles.row}
              wrap={false}
            >
              {headers.map((h, ci) => {
                const v = r[h];
                const right = typeof v === 'number';
                return (
                  <Text
                    key={ci}
                    style={
                      right
                        ? [styles.cell, colStyles[ci]!, styles.cellRight]
                        : [styles.cell, colStyles[ci]!]
                    }
                  >
                    {fmtCell(v)}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
        <View style={styles.footer} fixed>
          <Text>Apar — {title ?? 'Export'}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
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
 * Render `rows` as a paginated PDF table and trigger a download. `headers`
 * fixes the column order and which keys are emitted (matching `exportRows`).
 * Numeric cells are right-aligned and grouped with Indian digit separators.
 */
export async function downloadRowsAsPdf(
  rows: ReadonlyArray<Record<string, PdfCell>>,
  headers: readonly string[],
  filename: string,
  title?: string,
): Promise<void> {
  const blob = await pdf(<TableDoc title={title} headers={headers} rows={rows} />).toBlob();
  triggerDownload(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
