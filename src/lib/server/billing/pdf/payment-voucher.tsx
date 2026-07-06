import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { INTER_FONT_FAMILY } from './fonts';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import { formatINR } from '@/lib/money';

/**
 * Payment-voucher PDF — the document for money we PAY OUT to a vendor against
 * one or more recorded bills (kind `vendor_payment_made`). It is the vendor-side
 * counterpart of `payment-receipt.tsx`.
 *
 * Unlike a client receipt (which acknowledges money received), this voucher
 * records a disbursement. The ledger transaction requires a `source_document_id`
 * (`document_missing` is a block-severity control), so `recordVendorPayment`
 * generates this voucher and attaches it before posting — exactly mirroring how
 * `recordManualReceipt` generates the receipt voucher.
 *
 * Captured-not-computed: every monetary value is passed in verbatim; this
 * renderer only lays it out.
 */

export type PaymentVoucherPdfData = {
  payer: {
    name: string;
    address: string;
    gstin: string | null;
    pan: string | null;
    stateCode: string;
  };
  payee: {
    name: string;
    addressLines: string[];
    gstin: string | null;
  };
  voucherNumber: string;
  paymentDate: string;
  amountPaise: bigint;
  /** The agency bank account the money left from. */
  paidFromLabel: string | null;
  /** Bills this payment is applied to. */
  allocations: Array<{ documentNumber: string; allocatedPaise: bigint }>;
  /** Amount paid but not yet applied to a bill (held as a vendor advance). */
  unappliedPaise: bigint;
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  supplierBlock: { width: '60%' },
  metaBlock: { width: '38%' },
  metaTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: 8,
    color: '#0f172a',
  },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
  metaLabel: { fontWeight: 'bold', marginRight: 6 },
  divider: { height: 2, backgroundColor: '#0f172a', marginVertical: 10 },
  partyHeading: { fontSize: 9, color: '#6b7280', marginBottom: 2 },
  partyName: { fontSize: 11, fontWeight: 'bold', marginBottom: 2 },
  amountBlock: {
    marginTop: 14,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountLabel: { fontSize: 10, color: '#374151' },
  amountValue: { fontSize: 16, fontWeight: 'bold', color: '#991b1b' },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontWeight: 'bold',
    marginTop: 16,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: '1pt solid #e5e7eb',
  },
  colDoc: { width: '70%' },
  colAmt: { width: '30%', textAlign: 'right' },
  sectionHeading: {
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
    marginTop: 14,
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

export async function renderPaymentVoucherPdf(data: PaymentVoucherPdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<PaymentVoucherDocument data={data} />);
  return new Uint8Array(buffer);
}

export function PaymentVoucherDocument({
  data,
}: {
  data: PaymentVoucherPdfData;
}): React.JSX.Element {
  return (
    <Document
      title={`Payment Voucher ${data.voucherNumber}`}
      author={data.payer.name}
      subject={`Payment Voucher ${data.voucherNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.supplierBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={APAR_ORANGE_MARK_DATA_URI}
              style={{ height: 40, maxWidth: 180, marginBottom: 8, objectFit: 'contain' }}
            />
            <Text>{data.payer.address}</Text>
            {data.payer.gstin ? <Text>GSTIN: {data.payer.gstin}</Text> : null}
            {data.payer.pan ? <Text>PAN: {data.payer.pan}</Text> : null}
            <Text>State code: {data.payer.stateCode}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>PAYMENT VOUCHER</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{data.voucherNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text>{data.paymentDate}</Text>
            </View>
            {data.paidFromLabel ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Paid from</Text>
                <Text>{data.paidFromLabel}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.partyHeading}>Paid to</Text>
        <Text style={styles.partyName}>{data.payee.name}</Text>
        {data.payee.addressLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
        {data.payee.gstin ? <Text>GSTIN: {data.payee.gstin}</Text> : null}

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Amount paid</Text>
          <Text style={styles.amountValue}>{formatINR(data.amountPaise)}</Text>
        </View>

        {data.allocations.length > 0 ? (
          <>
            <View style={styles.tableHeader}>
              <Text style={styles.colDoc}>Applied to bill</Text>
              <Text style={styles.colAmt}>Amount</Text>
            </View>
            {data.allocations.map((a) => (
              <View key={a.documentNumber} style={styles.tableRow}>
                <Text style={styles.colDoc}>{a.documentNumber}</Text>
                <Text style={styles.colAmt}>{formatINR(a.allocatedPaise)}</Text>
              </View>
            ))}
          </>
        ) : null}

        {data.unappliedPaise > 0n ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.sectionHeading}>Held as advance (unapplied)</Text>
            <Text>{formatINR(data.unappliedPaise)}</Text>
          </View>
        ) : null}

        {data.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.sectionHeading}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${data.payer.name} — Payment Voucher ${data.voucherNumber} — Page ${pageNumber} of ${totalPages} — Computer-generated; no signature required.`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
