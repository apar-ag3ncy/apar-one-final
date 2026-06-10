import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import { formatINR } from '@/lib/money';

/**
 * Invoice PDF renderer. Phase 2.5 — replaces the Phase 2.4 skeleton
 * (which threw 'billing.pdf_not_implemented') with a working renderer
 * backed by `@react-pdf/renderer`.
 *
 * Rule 46 fields covered (CBIC GST tax-invoice requirements):
 *   1.  Supplier name, address, GSTIN, contact
 *   2.  Sequential invoice number, date
 *   3.  Recipient name, address, GSTIN
 *   4.  Place of supply (2-digit state code)
 *   5.  HSN/SAC per line
 *   6.  Description, qty, rate, taxable value per line
 *   7.  Tax-rate breakdown: CGST+SGST OR IGST + cess
 *   8.  Total tax + grand total
 *   9.  Reverse-charge flag
 *   10. "Computer-generated invoice" footer (signature optional in v1)
 *   11. Terms + notes
 *   12. Payment-link section (Phase 4 supplies the URL/QR)
 *
 * Captured-not-computed: every monetary field comes verbatim from the
 * `InvoicePdfData` snapshot. The renderer does NOT recompute taxes,
 * sums, or totals — `loadInvoicePdfData` (in `load-data.ts`) reads
 * the captured values from the invoice rows; this renderer just lays
 * them out.
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
  paymentLink: {
    url: string;
    qrPngBytes: Uint8Array | null;
  } | null;
  terms: string | null;
  notes: string | null;
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

/** Merge the optional theme overlay onto neutral defaults. */
function resolveTheme(o: InvoicePdfData['themeOverrides']): ResolvedTheme {
  const font = o?.fontFamily && BUILTIN_FONTS.has(o.fontFamily) ? o.fontFamily : 'Helvetica';
  return {
    primary: o?.primaryColor || '#0f172a',
    accent: o?.accentColor || '#f3f4f6',
    font,
    headerText: o?.headerText || 'TAX INVOICE',
    footerText: o?.footerText || 'Computer-generated; no signature required.',
    logoDataUri: o?.logoDataUri ?? null,
  };
}

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

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111827',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  supplierBlock: { width: '60%' },
  metaBlock: { width: '38%' },
  supplierName: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  metaTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 8,
    color: '#0f172a',
  },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
  metaLabel: { fontWeight: 'bold', marginRight: 6 },
  divider: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 10 },
  twoColRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  partyHeading: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
  partyName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  reverseChargeFlag: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 4,
    marginBottom: 10,
    fontSize: 9,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: '1pt solid #e5e7eb',
  },
  colNo: { width: '5%' },
  colDesc: { width: '38%' },
  colSac: { width: '10%' },
  colQty: { width: '7%', textAlign: 'right' },
  colRate: { width: '12%', textAlign: 'right' },
  colTaxable: { width: '12%', textAlign: 'right' },
  colTaxRate: { width: '6%', textAlign: 'right' },
  colTax: { width: '10%', textAlign: 'right' },
  totalsBlock: { marginTop: 12, alignSelf: 'flex-end', width: '40%' },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginTop: 4,
    borderTop: '1pt solid #111827',
    fontWeight: 'bold',
    fontSize: 11,
  },
  footerBlock: { marginTop: 18 },
  footerHeading: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
    color: '#374151',
  },
  paymentBlock: {
    marginTop: 18,
    padding: 10,
    backgroundColor: '#f0f9ff',
    borderRadius: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 7,
    color: '#9ca3af',
  },
});

function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Render an invoice to PDF bytes. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<InvoiceDocument data={data} />);
  return new Uint8Array(buffer);
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }): React.JSX.Element {
  const theme = resolveTheme(data.themeOverrides);
  // A proforma is titled "PROFORMA INVOICE" regardless of the theme's header
  // text; a tax invoice uses the theme header (default "TAX INVOICE").
  const isProforma = data.documentType === 'proforma';
  const documentTitle = isProforma ? 'PROFORMA INVOICE' : theme.headerText;
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
      <Page size="A4" style={[styles.page, { fontFamily: theme.font }]}>
        <Header data={data} theme={theme} />
        <View style={[styles.divider, { backgroundColor: theme.primary, height: 2 }]} />
        <Parties data={data} />
        {data.isReverseCharge ? (
          <Text style={styles.reverseChargeFlag}>
            Reverse charge applicable — recipient pays GST under §9(3)/9(4) of the CGST Act.
          </Text>
        ) : null}
        <LinesTable data={data} theme={theme} />
        <Totals data={data} theme={theme} />
        {data.paymentLink ? <PaymentBlock link={data.paymentLink} /> : null}
        <Footer data={data} />
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.supplier.name} — ${documentTitle} ${data.documentNumber} — Page ${pageNumber} of ${totalPages} — ${theme.footerText}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function Header({
  data,
  theme,
}: {
  data: InvoicePdfData;
  theme: ResolvedTheme;
}): React.JSX.Element {
  return (
    <View style={styles.headerRow}>
      <View style={styles.supplierBlock}>
        {/* The supplier identity is shown as the Apār logo (or the theme's own
            logo, if one was uploaded) — never the plain "Apār" text. */}
        {/* react-pdf's <Image> is a PDF primitive, not an HTML <img> — no `alt`. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image
          src={theme.logoDataUri ?? APAR_ORANGE_MARK_DATA_URI}
          style={{ height: 40, maxWidth: 180, marginBottom: 8, objectFit: 'contain' }}
        />
        <Text>{data.supplier.address}</Text>
        {data.supplier.gstin ? <Text>GSTIN: {data.supplier.gstin}</Text> : null}
        {data.supplier.pan ? <Text>PAN: {data.supplier.pan}</Text> : null}
        <Text>State code: {data.supplier.stateCode}</Text>
        {data.supplier.contactEmail ? <Text>{data.supplier.contactEmail}</Text> : null}
        {data.supplier.contactPhone ? <Text>{data.supplier.contactPhone}</Text> : null}
      </View>
      <View style={styles.metaBlock}>
        <Text style={[styles.metaTitle, { color: theme.primary }]}>
          {data.documentType === 'proforma' ? 'PROFORMA INVOICE' : theme.headerText}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>No.</Text>
          <Text>{data.documentNumber}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Date</Text>
          <Text>{data.documentDate}</Text>
        </View>
        {data.dueDate ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Due by</Text>
            <Text>{data.dueDate}</Text>
          </View>
        ) : null}
        {data.placeOfSupply ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Place of supply</Text>
            <Text>{data.placeOfSupply}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Parties({ data }: { data: InvoicePdfData }): React.JSX.Element {
  return (
    <View style={styles.twoColRow}>
      <View style={{ width: '48%' }}>
        <Text style={styles.partyHeading}>Bill to</Text>
        <Text style={styles.partyName}>{data.recipient.name}</Text>
        {data.recipient.addressLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
        {data.recipient.gstin ? <Text>GSTIN: {data.recipient.gstin}</Text> : null}
        {data.recipient.pan ? <Text>PAN: {data.recipient.pan}</Text> : null}
        {data.recipient.stateCode ? <Text>State code: {data.recipient.stateCode}</Text> : null}
        {data.recipient.contactEmail ? <Text>{data.recipient.contactEmail}</Text> : null}
      </View>
      <View style={{ width: '48%' }} />
    </View>
  );
}

function LinesTable({
  data,
  theme,
}: {
  data: InvoicePdfData;
  theme: ResolvedTheme;
}): React.JSX.Element {
  return (
    <View>
      <View style={[styles.tableHeader, { backgroundColor: theme.accent }]}>
        <Text style={styles.colNo}>#</Text>
        <Text style={styles.colDesc}>Description</Text>
        <Text style={styles.colSac}>SAC</Text>
        <Text style={styles.colQty}>Qty</Text>
        <Text style={styles.colRate}>Rate</Text>
        <Text style={styles.colTaxable}>Taxable</Text>
        <Text style={styles.colTaxRate}>Tax%</Text>
        <Text style={styles.colTax}>Tax</Text>
      </View>
      {data.lines.map((l) => (
        <View key={l.lineNo} style={styles.tableRow}>
          <Text style={styles.colNo}>{l.lineNo}</Text>
          <Text style={styles.colDesc}>
            {l.description}
            {l.unit ? <Text style={{ color: '#6b7280' }}>{`  (${l.unit})`}</Text> : null}
          </Text>
          <Text style={styles.colSac}>{l.sacCode ?? '—'}</Text>
          <Text style={styles.colQty}>{l.qty}</Text>
          <Text style={styles.colRate}>{formatINR(l.ratePaise)}</Text>
          <Text style={styles.colTaxable}>{formatINR(l.capturedTaxableValuePaise)}</Text>
          <Text style={styles.colTaxRate}>{bpsToPct(l.capturedTaxRateBps)}</Text>
          <Text style={styles.colTax}>{formatINR(l.capturedTaxAmountPaise)}</Text>
        </View>
      ))}
    </View>
  );
}

function Totals({
  data,
  theme,
}: {
  data: InvoicePdfData;
  theme: ResolvedTheme;
}): React.JSX.Element {
  const rows = totalsRowsFor(data);
  const grandIdx = rows.length - 1;
  return (
    <View style={styles.totalsBlock}>
      {rows.map((r, i) =>
        i === grandIdx ? (
          <View
            key={r.label}
            style={[
              styles.grandTotalRow,
              { borderTop: `2pt solid ${theme.primary}`, color: theme.primary },
            ]}
          >
            <Text>{r.label}</Text>
            <Text>{formatINR(r.valuePaise)}</Text>
          </View>
        ) : (
          <View key={r.label} style={styles.totalsRow}>
            <Text>{r.label}</Text>
            <Text>{formatINR(r.valuePaise)}</Text>
          </View>
        ),
      )}
    </View>
  );
}

function PaymentBlock({
  link,
}: {
  link: NonNullable<InvoicePdfData['paymentLink']>;
}): React.JSX.Element {
  return (
    <View style={styles.paymentBlock}>
      <Text style={styles.footerHeading}>Pay online</Text>
      <Text>{link.url}</Text>
      {/* QR rendering (link.qrPngBytes) lands when Phase 4 wires Razorpay. */}
    </View>
  );
}

function Footer({ data }: { data: InvoicePdfData }): React.JSX.Element {
  return (
    <View style={styles.footerBlock}>
      {data.terms ? (
        <View style={{ marginTop: 6 }}>
          <Text style={styles.footerHeading}>Terms</Text>
          <Text>{data.terms}</Text>
        </View>
      ) : null}
      {data.notes ? (
        <View style={{ marginTop: 6 }}>
          <Text style={styles.footerHeading}>Notes</Text>
          <Text>{data.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}
