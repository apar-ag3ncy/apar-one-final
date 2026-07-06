import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { INTER_FONT_FAMILY } from './fonts';
import * as React from 'react';

import { APAR_ORANGE_MARK_DATA_URI } from '@/lib/brand/apar-orange-mark';
import { formatINR } from '@/lib/money';

/**
 * Payment-receipt PDF — the acknowledgement document for money received from a
 * client against one or more raised invoices (kind `client_payment_received`).
 *
 * This is NOT the GST Rule 50 *advance* receipt voucher (`receipt-voucher.tsx`),
 * which documents advances against a *future* supply and carries GST. A payment
 * against an already-issued tax invoice carries no fresh GST (it was charged on
 * the invoice), so this voucher just acknowledges the cash received and lists
 * the invoices it settles.
 *
 * Captured-not-computed: every monetary value is passed in verbatim; this
 * renderer only lays it out. It is attached as the ledger transaction's
 * `source_document_id` (satisfying the `document_missing` control) and stored
 * so the client can download a receipt.
 */

export type PaymentReceiptPdfData = {
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
  };
  receiptNumber: string;
  receiptDate: string;
  amountPaise: bigint;
  method: string;
  bankLabel: string | null;
  /** Invoices this receipt is applied to. */
  allocations: Array<{ documentNumber: string; allocatedPaise: bigint }>;
  /** Amount received but not yet applied to an invoice (held on account). */
  unappliedPaise: bigint;
  notes: string | null;
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  cash: 'Cash',
  card: 'Card',
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
  supplierName: { fontSize: 14, fontWeight: 'bold', marginBottom: 4, color: '#0f172a' },
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
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  amountLabel: { fontSize: 10, color: '#374151' },
  amountValue: { fontSize: 16, fontWeight: 'bold', color: '#166534' },
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

export async function renderPaymentReceiptPdf(data: PaymentReceiptPdfData): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<PaymentReceiptDocument data={data} />);
  return new Uint8Array(buffer);
}

export function PaymentReceiptDocument({
  data,
}: {
  data: PaymentReceiptPdfData;
}): React.JSX.Element {
  return (
    <Document
      title={`Payment Receipt ${data.receiptNumber}`}
      author={data.supplier.name}
      subject={`Payment Receipt ${data.receiptNumber}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.supplierBlock}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image
              src={APAR_ORANGE_MARK_DATA_URI}
              style={{ height: 40, maxWidth: 180, marginBottom: 8, objectFit: 'contain' }}
            />
            <Text>{data.supplier.address}</Text>
            {data.supplier.gstin ? <Text>GSTIN: {data.supplier.gstin}</Text> : null}
            {data.supplier.pan ? <Text>PAN: {data.supplier.pan}</Text> : null}
            <Text>State code: {data.supplier.stateCode}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>PAYMENT RECEIPT</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{data.receiptNumber}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Date</Text>
              <Text>{data.receiptDate}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Mode</Text>
              <Text>
                {METHOD_LABEL[data.method] ?? data.method}
                {data.bankLabel ? ` · ${data.bankLabel}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.partyHeading}>Received with thanks from</Text>
        <Text style={styles.partyName}>{data.recipient.name}</Text>
        {data.recipient.addressLines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
        {data.recipient.gstin ? <Text>GSTIN: {data.recipient.gstin}</Text> : null}

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Amount received</Text>
          <Text style={styles.amountValue}>{formatINR(data.amountPaise)}</Text>
        </View>

        {data.allocations.length > 0 ? (
          <>
            <View style={styles.tableHeader}>
              <Text style={styles.colDoc}>Applied to invoice</Text>
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
            <Text style={styles.sectionHeading}>Held on account (unapplied)</Text>
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
            `${data.supplier.name} — Payment Receipt ${data.receiptNumber} — Page ${pageNumber} of ${totalPages} — Computer-generated; no signature required.`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
