import 'server-only';

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import * as React from 'react';

import { formatINR } from '@/lib/money';

/**
 * GST Rule 50 — Receipt Voucher PDF. Issued when Apar receives an
 * advance from a customer against future supply of services.
 *
 * Rule 50 statutory fields:
 *   - Supplier name, address, GSTIN
 *   - Voucher number (sequential per FY, distinct from invoice series)
 *   - Voucher date
 *   - Recipient name, address, GSTIN (if registered)
 *   - Description of goods/services planned (we capture the SAC)
 *   - Amount of advance
 *   - Rate of tax (CGST/SGST/IGST)
 *   - Amount of tax
 *   - Place of supply (mandatory for inter-state)
 *   - Whether reverse charge applies
 *   - Signature / signature placeholder
 *
 * The accountant must issue this BEFORE the actual invoice. When the
 * invoice is later raised and allocated to this advance,
 * `adjustAdvanceToInvoice` (Phase 4.7) unwinds the Rule 50 GST
 * accrual (Dr 2120 / Cr 1252) so the output GST is only paid once.
 */

export type ReceiptVoucherPdfData = {
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
  voucherNumber: string;
  voucherDate: string;
  placeOfSupply: string | null;
  /** SAC code of the planned service (captured at advance time). */
  sacCode: string | null;
  /** Free-text description of what the advance is against. */
  description: string | null;
  advancePaise: bigint;
  taxPaise: bigint;
  taxRateBps: number;
  /** True when supplier and recipient share the place-of-supply state. */
  isIntraState: boolean;
  isReverseCharge: boolean;
  notes: string | null;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#111827',
  },
  ruleLabel: {
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
    padding: 4,
    marginBottom: 12,
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
  reverseChargeFlag: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 4,
    marginBottom: 10,
    fontSize: 9,
  },
  amountBlock: {
    backgroundColor: '#f9fafb',
    padding: 12,
    marginTop: 12,
    borderLeft: '3pt solid #5b21b6',
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
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

export async function renderReceiptVoucherPdf(data: ReceiptVoucherPdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<ReceiptVoucherDocument data={data} />);
  return new Uint8Array(buffer);
}

export function ReceiptVoucherDocument({
  data,
}: {
  data: ReceiptVoucherPdfData;
}): React.JSX.Element {
  const totalPaise = data.advancePaise + data.taxPaise;
  const halfTax = data.taxPaise / 2n; // CGST = SGST = tax/2 for intra-state

  return (
    <Document
      title={`Receipt Voucher ${data.voucherNumber}`}
      author={data.supplier.name}
      subject={`GST Rule 50 — Receipt Voucher ${data.voucherNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.ruleLabel}>
          GST Rule 50 — Receipt Voucher (Advance against future supply of services)
        </Text>
        <View style={styles.headerRow}>
          <View style={styles.supplierBlock}>
            <Text style={styles.supplierName}>{data.supplier.name}</Text>
            <Text>{data.supplier.address}</Text>
            {data.supplier.gstin ? <Text>GSTIN: {data.supplier.gstin}</Text> : null}
            {data.supplier.pan ? <Text>PAN: {data.supplier.pan}</Text> : null}
            <Text>State code: {data.supplier.stateCode}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>RECEIPT VOUCHER</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{data.voucherNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text>{data.voucherDate}</Text>
            </View>
            {data.placeOfSupply ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Place of supply</Text>
                <Text>{data.placeOfSupply}</Text>
              </View>
            ) : null}
            {data.sacCode ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>SAC</Text>
                <Text>{data.sacCode}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.twoColRow}>
          <View style={{ width: '48%' }}>
            <Text style={styles.partyHeading}>Advance received from</Text>
            <Text style={styles.partyName}>{data.recipient.name}</Text>
            {data.recipient.addressLines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {data.recipient.gstin ? <Text>GSTIN: {data.recipient.gstin}</Text> : null}
            {data.recipient.stateCode ? <Text>State code: {data.recipient.stateCode}</Text> : null}
          </View>
          <View style={{ width: '48%' }} />
        </View>
        {data.description ? (
          <View style={{ marginBottom: 8 }}>
            <Text style={styles.footerHeading}>Against future supply of</Text>
            <Text>{data.description}</Text>
          </View>
        ) : null}
        {data.isReverseCharge ? (
          <Text style={styles.reverseChargeFlag}>
            Reverse charge applicable on the planned supply.
          </Text>
        ) : null}
        <View style={styles.amountBlock}>
          <View style={styles.amountRow}>
            <Text>Advance amount</Text>
            <Text>{formatINR(data.advancePaise)}</Text>
          </View>
          {data.taxPaise > 0n ? (
            data.isIntraState ? (
              <>
                <View style={styles.amountRow}>
                  <Text>CGST @ {bpsToPct(Math.round(data.taxRateBps / 2))}</Text>
                  <Text>{formatINR(halfTax)}</Text>
                </View>
                <View style={styles.amountRow}>
                  <Text>SGST @ {bpsToPct(Math.round(data.taxRateBps / 2))}</Text>
                  <Text>{formatINR(data.taxPaise - halfTax)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.amountRow}>
                <Text>IGST @ {bpsToPct(data.taxRateBps)}</Text>
                <Text>{formatINR(data.taxPaise)}</Text>
              </View>
            )
          ) : null}
          <View style={styles.grandRow}>
            <Text>Total received</Text>
            <Text>{formatINR(totalPaise)}</Text>
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
            `${data.supplier.name} — Receipt Voucher ${data.voucherNumber} — Page ${pageNumber} of ${totalPages} — Issued under GST Rule 50; tax adjusted on invoice issuance.`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
