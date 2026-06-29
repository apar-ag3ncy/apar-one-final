import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import {
  DEFAULT_INVOICE_LAYOUT,
  type InvoiceBlockId,
  type InvoiceLayout,
} from '@/lib/billing/invoice-layout';
import {
  AMOUNT_COL_WIDTH,
  DEFAULT_INVOICE_STYLE,
  invoiceTableColumns,
  metricsFor,
  readableTextOn,
  type InvoiceMetrics,
  type InvoiceStyle,
  type TableCol,
} from '@/lib/billing/invoice-style';
import { formatRupeesPlain, rupeesInWordsINR } from '@/lib/money';

/**
 * Invoice PDF renderer. Layout modelled on the provided AFTRBRND invoice
 * template: company header (left) + brand mark / document meta (right), a
 * "Billed To" block, a fully-bordered line-item table whose footer rows carry
 * Sub Total / CGST / SGST / IGST / TOTAL, the amount in words, and an
 * authorised-signatory block.
 *
 * Captured-not-computed: every monetary field comes verbatim from the
 * `InvoicePdfData` snapshot (assembled by `loadInvoicePdfData`). The renderer
 * never recomputes taxes or totals — it only lays them out. The GST-rate labels
 * (e.g. "CGST @ 9%") are derived for display from the captured amounts.
 */

export type InvoicePdfData = {
  supplier: {
    name: string;
    address: string;
    gstin: string | null;
    pan: string | null;
    stateCode: string;
    contactEmail: string | null;
    contactPhone: string | null;
    logoBucket: string | null;
    logoStoragePath: string | null;
  };
  recipient: {
    name: string;
    addressLines: string[];
    gstin: string | null;
    pan: string | null;
    stateCode: string | null;
    contactEmail: string | null;
  };
  documentNumber: string;
  /** 'proforma' titles the document "PROFORMA INVOICE"; otherwise "TAX INVOICE". */
  documentType?: 'invoice' | 'proforma';
  documentDate: string;
  dueDate: string | null;
  placeOfSupply: string | null;
  isReverseCharge: boolean;
  lines: Array<{
    lineNo: number;
    description: string;
    sacCode: string | null;
    unit: string | null;
    qty: number;
    ratePaise: bigint;
    capturedTaxableValuePaise: bigint;
    capturedTaxRateBps: number;
    capturedTaxAmountPaise: bigint;
  }>;
  subtotalPaise: bigint;
  capturedTaxSplit: {
    cgstPaise: bigint;
    sgstPaise: bigint;
    igstPaise: bigint;
    cessPaise: bigint;
  };
  capturedTaxTotalPaise: bigint;
  capturedTotalPaise: bigint;
  /**
   * The agency's bank payment instructions for this invoice. Null when no
   * company bank account is configured (Settings → Billing).
   */
  payment: {
    beneficiaryName: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    branchName: string | null;
  } | null;
  paymentLink: {
    url: string;
    qrPngBytes: Uint8Array | null;
  } | null;
  terms: string | null;
  notes: string | null;
  /**
   * Block placement for the page (from the selected theme's `tokens.layout`,
   * sanitised by `loadInvoicePdfData`). Optional — the renderer falls back to
   * the classic layout when absent. The line-items + GST table is fixed and is
   * not part of this.
   */
  layout?: InvoiceLayout;
  /**
   * Visual style tokens (font scale, density, logo size/align, accent band,
   * total emphasis, heading colour) from the theme's `tokens.style`. Optional —
   * the renderer falls back to sensible defaults.
   */
  style?: InvoiceStyle;
  /**
   * Optional theme overlay (from the selected/ default `invoice_themes` row,
   * resolved by `loadInvoicePdfData`). Brand tokens only — the layout is
   * unchanged. Absent → the template's neutral defaults are used.
   */
  themeOverrides?: {
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
    /** Must be a react-pdf built-in family; clamped in `resolveTheme`. */
    fontFamily?: string | null;
    headerText?: string | null;
    footerText?: string | null;
    /** `data:image/...;base64,...` for the brand logo, or null. */
    logoDataUri?: string | null;
  } | null;
};

/** react-pdf can only lay out its three built-in font families on the server. */
const BUILTIN_FONTS = new Set(['Helvetica', 'Times-Roman', 'Courier']);

type ResolvedTheme = {
  primary: string;
  accent: string;
  font: string;
  headerText: string;
  footerText: string;
  logoDataUri: string | null;
};

/** Resolved style — point metrics + colours + polish flags threaded to blocks. */
type Dyn = {
  m: InvoiceMetrics;
  /** Section-heading colour (brand colour when `colorHeadings`, else near-black). */
  headingColor: string;
  /** Document-title colour. */
  titleColor: string;
  accent: string;
  primary: string;
  accentBand: boolean;
  emphasizeTotal: boolean;
  logoAlign: 'left' | 'center' | 'right';
  /** Resolved table colours. */
  tableHeaderBg: string;
  tableHeaderText: string;
  totalBg: string;
  totalText: string;
  /** Ordered, sized line-item columns. */
  columns: TableCol[];
};

/** Merge the optional theme overlay onto neutral defaults. */
function resolveTheme(o: InvoicePdfData['themeOverrides']): ResolvedTheme {
  const font = o?.fontFamily && BUILTIN_FONTS.has(o.fontFamily) ? o.fontFamily : 'Helvetica';
  return {
    primary: o?.primaryColor || '#111111',
    accent: o?.accentColor || '#f3f4f6',
    font,
    headerText: o?.headerText || 'TAX INVOICE',
    footerText: o?.footerText || 'Computer-generated; no signature required.',
    logoDataUri: o?.logoDataUri ?? null,
  };
}

/**
 * Flat list of total rows. Kept for unit tests / any consumer that wants the
 * captured totals as data; the on-page layout renders the equivalent rows
 * inside the bordered table footer.
 */
export function totalsRowsFor(data: InvoicePdfData): Array<{ label: string; valuePaise: bigint }> {
  const rows: Array<{ label: string; valuePaise: bigint }> = [
    { label: 'Subtotal', valuePaise: data.subtotalPaise },
  ];
  const s = data.capturedTaxSplit;
  if (s.cgstPaise > 0n) rows.push({ label: 'CGST', valuePaise: s.cgstPaise });
  if (s.sgstPaise > 0n) rows.push({ label: 'SGST', valuePaise: s.sgstPaise });
  if (s.igstPaise > 0n) rows.push({ label: 'IGST', valuePaise: s.igstPaise });
  if (s.cessPaise > 0n) rows.push({ label: 'CESS', valuePaise: s.cessPaise });
  rows.push({ label: 'Total tax', valuePaise: data.capturedTaxTotalPaise });
  rows.push({ label: 'Grand total', valuePaise: data.capturedTotalPaise });
  return rows;
}

/** Display-only GST rate label derived from the captured amounts, e.g. "9%". */
function pctLabel(part: bigint, base: bigint): string {
  if (base <= 0n || part <= 0n) return '';
  const pct = Math.round((Number(part) / Number(base)) * 10000) / 100;
  const text = Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return ` @ ${text}%`;
}

const BORDER = '0.75pt solid #111111';

const styles = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingHorizontal: 40,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111111',
    lineHeight: 1.35,
  },

  /* Header */
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  supplierBlock: { width: '58%' },
  metaBlock: { width: '40%', alignItems: 'flex-end' },
  supplierName: { fontSize: 12, fontWeight: 'bold', marginBottom: 3 },
  logo: { height: 34, maxWidth: 160, marginBottom: 8, objectFit: 'contain' },
  logoWrap: { width: '100%' },
  metaTitle: { fontSize: 13, fontWeight: 'bold', marginBottom: 4 },
  metaLine: { textAlign: 'right' },
  textRight: { textAlign: 'right' },

  rule: { height: 1, backgroundColor: '#111111', marginVertical: 12 },

  /* Billed to */
  billedTo: { marginBottom: 12 },
  billedToLabel: { color: '#6b7280', marginBottom: 2 },
  billedToName: { fontSize: 11, fontWeight: 'bold', marginBottom: 1 },

  reverseChargeFlag: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 4,
    marginBottom: 8,
    fontSize: 8.5,
  },

  /* Bordered table (top + left on the wrap, right + bottom on each cell) */
  table: { borderTop: BORDER, borderLeft: BORDER },
  row: { flexDirection: 'row' },
  cell: { borderRight: BORDER, borderBottom: BORDER, paddingVertical: 5, paddingHorizontal: 6 },
  headCell: { backgroundColor: '#f3f4f6', fontWeight: 'bold' },
  cSr: { width: '9%' },
  cDesc: { width: '50%' },
  cHsn: { width: '16%' },
  cAmt: { width: '25%', textAlign: 'right' },
  cSummaryLabel: { width: '66%', textAlign: 'right', fontWeight: 'bold' },
  totalRow: { fontWeight: 'bold', fontSize: 10.5 },

  amountWords: { marginTop: 10, fontStyle: 'italic' },

  block: { marginTop: 12 },
  blockHeading: { fontWeight: 'bold', marginBottom: 2 },

  /* Bank + signatory */
  footRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  signatory: { width: '45%', alignItems: 'flex-end' },
  signatureSpace: { height: 28 },
  emailMuted: { color: '#b7b7b7', fontSize: 8 },

  paymentBlock: { marginTop: 14, padding: 10, backgroundColor: '#f0f9ff', borderRadius: 4 },

  /* Bank payment details */
  payDetails: {
    marginTop: 14,
    padding: 10,
    borderRadius: 4,
    backgroundColor: '#f9fafb',
    border: BORDER,
  },
  payLine: { flexDirection: 'row', marginBottom: 1.5 },
  payLabel: { width: 70, color: '#6b7280' },
  payVal: { flex: 1 },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 7,
    color: '#9ca3af',
  },
});

/** Render an invoice to PDF bytes. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<InvoiceDocument data={data} />);
  return new Uint8Array(buffer);
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }): React.JSX.Element {
  const theme = resolveTheme(data.themeOverrides);
  const layout = data.layout ?? DEFAULT_INVOICE_LAYOUT;
  const style = data.style ?? DEFAULT_INVOICE_STYLE;
  const m = metricsFor(style);
  const col = style.colors;
  const dyn: Dyn = {
    m,
    headingColor: col.heading ?? (style.colorHeadings ? theme.primary : '#111111'),
    titleColor: col.title ?? theme.primary,
    accent: theme.accent,
    primary: theme.primary,
    accentBand: style.accentHeaderBand,
    emphasizeTotal: style.emphasizeTotal,
    logoAlign: style.logoAlign,
    tableHeaderBg: col.tableHeaderBg ?? theme.accent,
    tableHeaderText: col.tableHeaderText ?? readableTextOn(col.tableHeaderBg ?? theme.accent),
    totalBg: col.totalBg ?? theme.accent,
    totalText: col.totalText ?? readableTextOn(col.totalBg ?? theme.accent),
    columns: invoiceTableColumns(style),
  };
  const isProforma = data.documentType === 'proforma';
  const title = isProforma ? 'PROFORMA INVOICE' : theme.headerText;

  // Map a layout block id to its rendered element. Header blocks know their
  // column side (for text alignment); body blocks are full-width. Each returns
  // null when it has no content, so an empty block simply collapses.
  const headerBlock = (id: InvoiceBlockId, align: 'left' | 'right'): React.JSX.Element | null => {
    switch (id) {
      case 'logo':
        return <LogoBlock key={id} theme={theme} dyn={dyn} />;
      case 'supplier':
        return <SupplierBlock key={id} data={data} dyn={dyn} align={align} />;
      case 'meta':
        return (
          <MetaBlock key={id} data={data} theme={theme} dyn={dyn} title={title} align={align} />
        );
      case 'billTo':
        return <BilledTo key={id} data={data} dyn={dyn} align={align} />;
      default:
        return null;
    }
  };

  const bodyBlock = (id: InvoiceBlockId): React.JSX.Element | null => {
    switch (id) {
      case 'billTo':
        return <BilledTo key={id} data={data} dyn={dyn} align="left" />;
      case 'amountWords':
        return (
          <Text key={id} style={[styles.amountWords, { marginTop: m.blockGap }]}>
            {rupeesInWordsINR(data.capturedTotalPaise)}
          </Text>
        );
      case 'terms':
        return <TermsBlock key={id} data={data} dyn={dyn} />;
      case 'notes':
        return <NotesBlock key={id} data={data} dyn={dyn} />;
      case 'payment':
        return data.payment ? <PaymentDetails key={id} payment={data.payment} dyn={dyn} /> : null;
      case 'paymentLink':
        return data.paymentLink ? (
          <PaymentBlock key={id} link={data.paymentLink} dyn={dyn} />
        ) : null;
      case 'signatory':
        return <Signatory key={id} data={data} dyn={dyn} />;
      default:
        return null;
    }
  };

  return (
    <Document
      title={`${isProforma ? 'Proforma' : 'Invoice'} ${data.documentNumber}`}
      author={data.supplier.name}
      subject={
        isProforma
          ? `Proforma Invoice — ${data.documentNumber}`
          : `Tax Invoice (Rule 46) — ${data.documentNumber}`
      }
    >
      <Page
        size="A4"
        style={[
          styles.page,
          {
            fontFamily: theme.font,
            fontSize: m.fontSize,
            paddingTop: m.padTop,
            paddingLeft: m.padLeft,
            paddingRight: m.padRight,
            paddingBottom: m.padBottom,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.supplierBlock}>
            {layout.header.left.map((id) => headerBlock(id, 'left'))}
          </View>
          <View style={styles.metaBlock}>
            {layout.header.right.map((id) => headerBlock(id, 'right'))}
          </View>
        </View>
        <View style={[styles.rule, { backgroundColor: theme.primary }]} />
        {layout.aboveTable.map((id) => bodyBlock(id))}
        {/* Reverse-charge flag stays pinned directly above the (fixed) table. */}
        {data.isReverseCharge ? (
          <Text style={styles.reverseChargeFlag}>
            Reverse charge applicable — recipient pays GST under §9(3)/9(4) of the CGST Act.
          </Text>
        ) : null}
        <LinesTable data={data} dyn={dyn} />
        {layout.belowTable.map((id) => bodyBlock(id))}
        <Text
          style={[
            styles.footer,
            { left: m.padLeft, right: m.padRight, bottom: Math.max(8, m.padBottom - 18) },
          ]}
          render={({ pageNumber, totalPages }) =>
            `${data.supplier.name} — ${title} ${data.documentNumber} — Page ${pageNumber} of ${totalPages} — ${theme.footerText}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function LogoBlock({ theme, dyn }: { theme: ResolvedTheme; dyn: Dyn }): React.JSX.Element {
  const align = dyn.logoAlign;
  const alignItems = align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end';
  return (
    <View style={[styles.logoWrap, { alignItems }]}>
      {/* The brand mark — the orange Apar wordmark, or the theme's uploaded logo. */}
      {/* react-pdf's <Image> is a PDF primitive, not an HTML <img> — no `alt`. */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image
        src={theme.logoDataUri ?? APAR_ORANGE_MARK_DATA_URI}
        style={[styles.logo, { height: dyn.m.logoHeight, maxWidth: dyn.m.logoMaxWidth }]}
      />
    </View>
  );
}

function SupplierBlock({
  data,
  dyn,
  align,
}: {
  data: InvoicePdfData;
  dyn: Dyn;
  align: 'left' | 'right';
}): React.JSX.Element {
  const ta = align === 'right' ? styles.textRight : undefined;
  const nameStyle =
    align === 'right'
      ? [styles.supplierName, { fontSize: dyn.m.supplierNameSize }, styles.textRight]
      : [styles.supplierName, { fontSize: dyn.m.supplierNameSize }];
  return (
    <View>
      <Text style={nameStyle}>{data.supplier.name}</Text>
      {data.supplier.address ? <Text style={ta}>{data.supplier.address}</Text> : null}
      {data.supplier.contactPhone ? <Text style={ta}>Ph: {data.supplier.contactPhone}</Text> : null}
      {data.supplier.gstin ? <Text style={ta}>GST Reg. No.: {data.supplier.gstin}</Text> : null}
      {data.supplier.pan ? <Text style={ta}>PAN: {data.supplier.pan}</Text> : null}
      {data.supplier.contactEmail ? <Text style={ta}>{data.supplier.contactEmail}</Text> : null}
    </View>
  );
}

function MetaBlock({
  data,
  theme,
  dyn,
  title,
  align,
}: {
  data: InvoicePdfData;
  theme: ResolvedTheme;
  dyn: Dyn;
  title: string;
  align: 'left' | 'right';
}): React.JSX.Element {
  const right = align === 'right';
  const lineStyle = right ? styles.metaLine : undefined;
  return (
    <View>
      {dyn.accentBand ? (
        <View
          style={{
            backgroundColor: theme.accent,
            paddingVertical: 3,
            paddingHorizontal: 7,
            borderRadius: 3,
            marginBottom: 4,
            alignSelf: right ? 'flex-end' : 'flex-start',
          }}
        >
          <Text style={{ fontSize: dyn.m.titleSize, fontWeight: 'bold', color: dyn.titleColor }}>
            {title}
          </Text>
        </View>
      ) : (
        <Text
          style={
            right
              ? [
                  styles.metaTitle,
                  { fontSize: dyn.m.titleSize, color: dyn.titleColor },
                  styles.textRight,
                ]
              : [styles.metaTitle, { fontSize: dyn.m.titleSize, color: dyn.titleColor }]
          }
        >
          {title}
        </Text>
      )}
      <Text style={lineStyle}>Invoice: {data.documentNumber}</Text>
      <Text style={lineStyle}>Date: {data.documentDate}</Text>
      {data.dueDate ? <Text style={lineStyle}>Due by: {data.dueDate}</Text> : null}
      {data.placeOfSupply ? (
        <Text style={lineStyle}>Place of supply: {data.placeOfSupply}</Text>
      ) : null}
    </View>
  );
}

function BilledTo({
  data,
  dyn,
  align = 'left',
}: {
  data: InvoicePdfData;
  dyn: Dyn;
  align?: 'left' | 'right';
}): React.JSX.Element {
  const ta = align === 'right' ? styles.textRight : undefined;
  return (
    <View style={styles.billedTo}>
      <Text
        style={align === 'right' ? [styles.billedToLabel, styles.textRight] : styles.billedToLabel}
      >
        Billed To,
      </Text>
      <Text
        style={
          align === 'right'
            ? [styles.billedToName, { fontSize: dyn.m.recipientNameSize }, styles.textRight]
            : [styles.billedToName, { fontSize: dyn.m.recipientNameSize }]
        }
      >
        {data.recipient.name}
      </Text>
      {data.recipient.addressLines.map((l, i) => (
        <Text key={i} style={ta}>
          {l}
        </Text>
      ))}
      {data.recipient.gstin ? <Text style={ta}>GST Reg. No.: {data.recipient.gstin}</Text> : null}
      {data.recipient.pan ? <Text style={ta}>PAN: {data.recipient.pan}</Text> : null}
    </View>
  );
}

/** Per-line GST rate label from basis points (1800 → "18%"). */
function taxPctLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

type LineRow = InvoicePdfData['lines'][number];

/** The content of one body cell for a given column. */
function lineCellContent(l: LineRow, key: TableCol['key'], qtyRateOn: boolean): React.ReactNode {
  switch (key) {
    case 'srNo':
      return l.lineNo;
    case 'description':
      return (
        <>
          {l.description}
          {!qtyRateOn && l.qty > 1 ? (
            <Text style={{ color: '#6b7280' }}>{`  (Qty ${l.qty})`}</Text>
          ) : null}
        </>
      );
    case 'hsn':
      return l.sacCode ?? '—';
    case 'qty':
      return l.qty;
    case 'rate':
      return formatRupeesPlain(l.ratePaise);
    case 'taxPct':
      return taxPctLabel(l.capturedTaxRateBps);
    case 'amount':
      return formatRupeesPlain(l.capturedTaxableValuePaise);
    default:
      return null;
  }
}

function LinesTable({ data, dyn }: { data: InvoicePdfData; dyn: Dyn }): React.JSX.Element {
  const cols = dyn.columns;
  const qtyRateOn = cols.some((c) => c.key === 'qty');
  const labelWidth = `${100 - AMOUNT_COL_WIDTH}%`;
  const amtWidth = `${AMOUNT_COL_WIDTH}%`;
  const totalExtra = dyn.emphasizeTotal
    ? { backgroundColor: dyn.totalBg, color: dyn.totalText }
    : {};

  const s = data.capturedTaxSplit;
  const summary: Array<{ label: string; valuePaise: bigint }> = [
    { label: 'Sub Total', valuePaise: data.subtotalPaise },
  ];
  if (s.cgstPaise > 0n)
    summary.push({
      label: `CGST${pctLabel(s.cgstPaise, data.subtotalPaise)}`,
      valuePaise: s.cgstPaise,
    });
  if (s.sgstPaise > 0n)
    summary.push({
      label: `SGST${pctLabel(s.sgstPaise, data.subtotalPaise)}`,
      valuePaise: s.sgstPaise,
    });
  if (s.igstPaise > 0n)
    summary.push({
      label: `IGST${pctLabel(s.igstPaise, data.subtotalPaise)}`,
      valuePaise: s.igstPaise,
    });
  if (s.cessPaise > 0n) summary.push({ label: 'CESS', valuePaise: s.cessPaise });

  return (
    <View style={styles.table}>
      {/* Header */}
      <View style={styles.row}>
        {cols.map((c) => (
          <Text
            key={c.key}
            style={[
              styles.cell,
              {
                width: `${c.width}%`,
                textAlign: c.align,
                backgroundColor: dyn.tableHeaderBg,
                color: dyn.tableHeaderText,
                fontWeight: 'bold',
              },
            ]}
          >
            {c.label}
          </Text>
        ))}
      </View>
      {/* Body */}
      {data.lines.map((l) => (
        <View key={l.lineNo} style={styles.row}>
          {cols.map((c) => (
            <Text key={c.key} style={[styles.cell, { width: `${c.width}%`, textAlign: c.align }]}>
              {lineCellContent(l, c.key, qtyRateOn)}
            </Text>
          ))}
        </View>
      ))}
      {/* Summary rows — label spans everything but the Amount column. */}
      {summary.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text
            style={[styles.cell, { width: labelWidth, textAlign: 'right', fontWeight: 'bold' }]}
          >
            {r.label}
          </Text>
          <Text style={[styles.cell, { width: amtWidth, textAlign: 'right' }]}>
            {formatRupeesPlain(r.valuePaise)}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        <Text
          style={[
            styles.cell,
            styles.totalRow,
            { width: labelWidth, textAlign: 'right', fontSize: dyn.m.totalSize, ...totalExtra },
          ]}
        >
          TOTAL
        </Text>
        <Text
          style={[
            styles.cell,
            styles.totalRow,
            { width: amtWidth, textAlign: 'right', fontSize: dyn.m.totalSize, ...totalExtra },
          ]}
        >
          {formatRupeesPlain(data.capturedTotalPaise)}
        </Text>
      </View>
    </View>
  );
}

function TermsBlock({ data, dyn }: { data: InvoicePdfData; dyn: Dyn }): React.JSX.Element | null {
  if (!data.terms) return null;
  return (
    <View style={[styles.block, { marginTop: dyn.m.blockGap }]}>
      <Text style={[styles.blockHeading, { color: dyn.headingColor }]}>Terms</Text>
      <Text>{data.terms}</Text>
    </View>
  );
}

function NotesBlock({ data, dyn }: { data: InvoicePdfData; dyn: Dyn }): React.JSX.Element | null {
  if (!data.notes) return null;
  return (
    <View style={[styles.block, { marginTop: dyn.m.blockGap }]}>
      <Text style={[styles.blockHeading, { color: dyn.headingColor }]}>Notes</Text>
      <Text>{data.notes}</Text>
    </View>
  );
}

function PaymentBlock({
  link,
  dyn,
}: {
  link: NonNullable<InvoicePdfData['paymentLink']>;
  dyn: Dyn;
}): React.JSX.Element {
  return (
    <View style={styles.paymentBlock}>
      <Text style={[styles.blockHeading, { color: dyn.headingColor }]}>Pay online</Text>
      <Text>{link.url}</Text>
      {/* QR rendering (link.qrPngBytes) lands when Phase 4 wires Razorpay. */}
    </View>
  );
}

function PayLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.payLine}>
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payVal}>{value}</Text>
    </View>
  );
}

function PaymentDetails({
  payment,
  dyn,
}: {
  payment: NonNullable<InvoicePdfData['payment']>;
  dyn: Dyn;
}): React.JSX.Element {
  return (
    <View style={[styles.payDetails, { marginTop: dyn.m.blockGap }]} wrap={false}>
      <Text style={[styles.blockHeading, { color: dyn.headingColor }]}>Payment details</Text>
      <PayLine label="Beneficiary" value={payment.beneficiaryName} />
      <PayLine label="Bank" value={payment.bankName} />
      <PayLine label="A/c No." value={payment.accountNumber} />
      <PayLine label="IFSC" value={payment.ifsc} />
      {payment.branchName ? <PayLine label="Branch" value={payment.branchName} /> : null}
    </View>
  );
}

function Signatory({ data, dyn }: { data: InvoicePdfData; dyn: Dyn }): React.JSX.Element {
  return (
    <View style={styles.footRow}>
      <View style={{ width: '50%' }} />
      <View style={styles.signatory}>
        <Text style={[styles.blockHeading, { color: dyn.headingColor }]}>
          For {data.supplier.name}
        </Text>
        <View style={styles.signatureSpace} />
        <Text>Authorised Signatory</Text>
        {data.supplier.contactEmail ? (
          <Text style={styles.emailMuted}>{data.supplier.contactEmail}</Text>
        ) : null}
      </View>
    </View>
  );
}
