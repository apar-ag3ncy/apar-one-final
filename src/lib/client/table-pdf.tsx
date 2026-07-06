'use client';

// Client-side "rows → PDF table" backing the shared export helpers. Kept in
// its own module so `@react-pdf/renderer` (heavy) is only pulled into a page's
// bundle when the user actually exports a PDF — callers reach it through a
// dynamic `import()` inside `exportRows` / the DataTable exporters, never a
// static import.

import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';

/** A cell value the table can render. Callers coerce richer types to these. */
export type PdfCell = string | number;

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

  // Column widths as percentages that always sum to 100%. Default is an even
  // split; when there are enough columns to make an even split cramped (>3),
  // give the first column — typically a description/name — a modest extra share
  // so long text there wraps over fewer lines. @react-pdf wraps cell <Text> by
  // default (no numberOfLines), so nothing here clips; this only trades width.
  const n = Math.max(1, headers.length);
  const colStyles = React.useMemo(() => {
    if (n <= 3) {
      const even = `${100 / n}%`;
      return headers.map(() => ({ width: even }));
    }
    const firstShare = 100 / n + 6; // modest boost for the first column
    const restShare = (100 - firstShare) / (n - 1);
    return headers.map((_, i) => ({ width: `${i === 0 ? firstShare : restShare}%` }));
  }, [headers, n]);

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
