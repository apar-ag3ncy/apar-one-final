import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { INTER_FONT_FAMILY } from './fonts';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import { formatINR } from '@/lib/money';

/**
 * GST Rule 53 — Credit Note PDF. Issued when a previously-issued
 * invoice needs an after-the-fact reduction (returned services,
 * billing error, agreed discount).
 *
 * Rule 53 statutory fields:
 *   - Supplier name, address, GSTIN
 *   - Credit note number (sequential per FY, distinct series)
 *   - Date of issue
 *   - Recipient name, address, GSTIN
 *   - Reference to the original invoice number + date
 *   - Reason for credit
 *   - Description per line (qty, taxable value, tax rate, tax amount)
 *   - Place of supply (mandatory for inter-state)
 *   - Whether the credit reverses GST output (gstImpactAllowed) — must
 *     be visible on the document so the recipient knows whether to
 *     adjust their input credit.
 */

export type CreditNotePdfData = {
  supplier: {
    name: string;
    address: string;
    gstin: string | null;
    pan: string | null;
    stateCode: string;
  };
  recipient: {
    name: string;
    addressLines: string[];
    gstin: string | null;
    stateCode: string | null;
  };
  creditNoteNumber: string;
  creditNoteDate: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  placeOfSupply: string | null;
  reason: string;
  /** True if the credit note reverses output GST (within §34(2) window). */
  gstImpactAllowed: boolean;
  lines: Array<{
    lineNo: number;
    description: string;
    sacCode: string | null;
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
  notes: string | null;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: INTER_FONT_FAMILY,
    color: '#111827',
  },
  ruleLabel: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 4,
    marginBottom: 12,
    fontSize: 9,
    textAlign: 'center',
  },
  commercialOnlyLabel: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: 4,
    marginBottom: 10,
    fontSize: 9,
    textAlign: 'center',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  supplierBlock: { width: '60%' },
  metaBlock: { width: '38%' },
  supplierName: { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  metaTitle: {
    fontSize: 16,
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
  reasonBlock: {
    marginTop: 4,
    marginBottom: 8,
    padding: 8,
    backgroundColor: '#f9fafb',
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
  colDesc: { width: '40%' },
  colSac: { width: '10%' },
  colQty: { width: '7%', textAlign: 'right' },
  colRate: { width: '12%', textAlign: 'right' },
  colTaxable: { width: '12%', textAlign: 'right' },
  colTaxRate: { width: '6%', textAlign: 'right' },
  colTax: { width: '8%', textAlign: 'right' },
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
  footerHeading: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
    color: '#374151',
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

export async function renderCreditNotePdf(data: CreditNotePdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<CreditNoteDocument data={data} />);
  return new Uint8Array(buffer);
}

export function CreditNoteDocument({ data }: { data: CreditNotePdfData }): React.JSX.Element {
  return (
    <Document
      title={`Credit Note ${data.creditNoteNumber}`}
      author={data.supplier.name}
      subject={`GST Rule 53 — Credit Note ${data.creditNoteNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.ruleLabel}>
          GST Rule 53 — Credit Note (against original invoice {data.originalInvoiceNumber})
        </Text>
        {!data.gstImpactAllowed ? (
          <Text style={styles.commercialOnlyLabel}>
            Commercial-only credit note. Issued after CGST §34(2) window (Nov 30 of FY+1) — does NOT
            reduce output GST liability. Recipient should NOT reduce their input tax credit.
          </Text>
        ) : null}
        <View style={styles.headerRow}>
          <View style={styles.supplierBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={APAR_ORANGE_MARK_DATA_URI}
              style={{ height: 34, maxWidth: 170, marginBottom: 6, objectFit: 'contain' }}
            />
            <Text style={styles.supplierName}>{data.supplier.name}</Text>
            <Text>{data.supplier.address}</Text>
            {data.supplier.gstin ? <Text>GSTIN: {data.supplier.gstin}</Text> : null}
            {data.supplier.pan ? <Text>PAN: {data.supplier.pan}</Text> : null}
            <Text>State code: {data.supplier.stateCode}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>CREDIT NOTE</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{data.creditNoteNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text>{data.creditNoteDate}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Original invoice</Text>
              <Text>{data.originalInvoiceNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Invoice date</Text>
              <Text>{data.originalInvoiceDate}</Text>
            </View>
            {data.placeOfSupply ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Place of supply</Text>
                <Text>{data.placeOfSupply}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.twoColRow}>
          <View style={{ width: '48%' }}>
            <Text style={styles.partyHeading}>Credit to</Text>
            <Text style={styles.partyName}>{data.recipient.name}</Text>
            {data.recipient.addressLines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {data.recipient.gstin ? <Text>GSTIN: {data.recipient.gstin}</Text> : null}
            {data.recipient.stateCode ? <Text>State code: {data.recipient.stateCode}</Text> : null}
          </View>
          <View style={{ width: '48%' }} />
        </View>
        <View style={styles.reasonBlock}>
          <Text style={styles.footerHeading}>Reason for credit</Text>
          <Text>{data.reason}</Text>
        </View>
        <View>
          <View style={styles.tableHeader}>
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
              <Text style={styles.colDesc}>{l.description}</Text>
              <Text style={styles.colSac}>{l.sacCode ?? '—'}</Text>
              <Text style={styles.colQty}>{l.qty}</Text>
              <Text style={styles.colRate}>{formatINR(l.ratePaise)}</Text>
              <Text style={styles.colTaxable}>{formatINR(l.capturedTaxableValuePaise)}</Text>
              <Text style={styles.colTaxRate}>{bpsToPct(l.capturedTaxRateBps)}</Text>
              <Text style={styles.colTax}>{formatINR(l.capturedTaxAmountPaise)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{formatINR(data.subtotalPaise)}</Text>
          </View>
          {data.capturedTaxSplit.cgstPaise > 0n ? (
            <View style={styles.totalsRow}>
              <Text>CGST</Text>
              <Text>{formatINR(data.capturedTaxSplit.cgstPaise)}</Text>
            </View>
          ) : null}
          {data.capturedTaxSplit.sgstPaise > 0n ? (
            <View style={styles.totalsRow}>
              <Text>SGST</Text>
              <Text>{formatINR(data.capturedTaxSplit.sgstPaise)}</Text>
            </View>
          ) : null}
          {data.capturedTaxSplit.igstPaise > 0n ? (
            <View style={styles.totalsRow}>
              <Text>IGST</Text>
              <Text>{formatINR(data.capturedTaxSplit.igstPaise)}</Text>
            </View>
          ) : null}
          {data.capturedTaxSplit.cessPaise > 0n ? (
            <View style={styles.totalsRow}>
              <Text>CESS</Text>
              <Text>{formatINR(data.capturedTaxSplit.cessPaise)}</Text>
            </View>
          ) : null}
          <View style={styles.totalsRow}>
            <Text>Total tax</Text>
            <Text>{formatINR(data.capturedTaxTotalPaise)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text>Total credit</Text>
            <Text>{formatINR(data.capturedTotalPaise)}</Text>
          </View>
        </View>
        {data.notes ? (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.footerHeading}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}
        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.supplier.name} — Credit Note ${data.creditNoteNumber} — Page ${pageNumber} of ${totalPages} — Issued under GST Rule 53.`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
