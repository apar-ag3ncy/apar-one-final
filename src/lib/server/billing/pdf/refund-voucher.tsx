import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY } from './fonts';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import { formatINR } from '@/lib/money';

/**
 * GST Rule 51 — Refund Voucher PDF. Issued when an advance previously
 * recorded under Rule 50 is refunded (in part or full) without a
 * taxable supply having taken place.
 *
 * Rule 51 statutory fields:
 *   - Supplier name, address, GSTIN
 *   - Refund voucher number (sequential per FY, distinct from invoice
 *     and receipt-voucher series)
 *   - Date of issue
 *   - Recipient name, address, GSTIN
 *   - Reference to the original receipt voucher number
 *   - Description of why the refund is being issued
 *   - Amount of refund + tax refunded
 *   - Signature placeholder
 *
 * Issuing this voucher reverses the Rule 50 GST accrual:
 *   Dr  2180 Client Advances Received (sub: client)
 *      Cr  1120 Bank (sub: bank)
 *   Dr  2120 GST Output Payable
 *      Cr  1252 Advance-Output-GST-Asset
 */

export type RefundVoucherPdfData = {
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
  originalReceiptVoucherNumber: string;
  originalReceiptVoucherDate: string;
  refundPaise: bigint;
  taxRefundPaise: bigint;
  reason: string;
  isIntraState: boolean;
  notes: string | null;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 36,
    paddingBottom: 60,
    fontSize: 9,
    fontFamily: PDF_FONT_FAMILY,
    color: '#111827',
  },
  ruleLabel: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
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
  amountBlock: {
    backgroundColor: '#fef2f2',
    padding: 12,
    marginTop: 12,
    borderLeft: '3pt solid #991b1b',
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
  reasonBlock: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#f9fafb',
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

export async function renderRefundVoucherPdf(data: RefundVoucherPdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<RefundVoucherDocument data={data} />);
  return new Uint8Array(buffer);
}

export function RefundVoucherDocument({ data }: { data: RefundVoucherPdfData }): React.JSX.Element {
  const totalPaise = data.refundPaise + data.taxRefundPaise;
  const halfTax = data.taxRefundPaise / 2n;

  return (
    <Document
      title={`Refund Voucher ${data.voucherNumber}`}
      author={data.supplier.name}
      subject={`GST Rule 51 — Refund Voucher ${data.voucherNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.ruleLabel}>
          GST Rule 51 — Refund Voucher (Refund of advance against unsupplied services)
        </Text>
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
            <Text style={styles.metaTitle}>REFUND VOUCHER</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{data.voucherNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text>{data.voucherDate}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Receipt Voucher</Text>
              <Text>{data.originalReceiptVoucherNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>RV date</Text>
              <Text>{data.originalReceiptVoucherDate}</Text>
            </View>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.twoColRow}>
          <View style={{ width: '48%' }}>
            <Text style={styles.partyHeading}>Refund to</Text>
            <Text style={styles.partyName}>{data.recipient.name}</Text>
            {data.recipient.addressLines.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {data.recipient.gstin ? <Text>GSTIN: {data.recipient.gstin}</Text> : null}
          </View>
          <View style={{ width: '48%' }} />
        </View>
        <View style={styles.reasonBlock}>
          <Text style={styles.footerHeading}>Reason for refund</Text>
          <Text>{data.reason}</Text>
        </View>
        <View style={styles.amountBlock}>
          <View style={styles.amountRow}>
            <Text>Refund amount</Text>
            <Text>{formatINR(data.refundPaise)}</Text>
          </View>
          {data.taxRefundPaise > 0n ? (
            data.isIntraState ? (
              <>
                <View style={styles.amountRow}>
                  <Text>CGST refund</Text>
                  <Text>{formatINR(halfTax)}</Text>
                </View>
                <View style={styles.amountRow}>
                  <Text>SGST refund</Text>
                  <Text>{formatINR(data.taxRefundPaise - halfTax)}</Text>
                </View>
              </>
            ) : (
              <View style={styles.amountRow}>
                <Text>IGST refund</Text>
                <Text>{formatINR(data.taxRefundPaise)}</Text>
              </View>
            )
          ) : null}
          <View style={styles.grandRow}>
            <Text>Total refunded</Text>
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
            `${data.supplier.name} — Refund Voucher ${data.voucherNumber} — Page ${pageNumber} of ${totalPages} — Issued under GST Rule 51; reverses Rule 50 receipt voucher ${data.originalReceiptVoucherNumber}.`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
