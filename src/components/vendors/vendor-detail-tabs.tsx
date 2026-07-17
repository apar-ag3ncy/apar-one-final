'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatINR } from '@/components/shared/format-inr';
import { UrlTabs, type UrlTab } from '@/components/shared/url-tabs';
import { ActivityFeed } from '@/components/entity/activity-feed';
import { DocumentList } from '@/components/entity/document-list';
import { DocumentsSection } from '@/components/entity/documents-section';
import { TransactionList } from '@/components/entity/transaction-list';
import { VendorBillsSection } from '@/components/entity/vendor-bills-section';
import { VendorPaymentsSection } from '@/components/entity/vendor-payments-section';
import { useEntityNavigate } from '@/lib/client/use-navigate';
import type { Vendor, VendorCategory } from './types';

const CATEGORY_LABELS: Record<VendorCategory, string> = {
  photographer: 'Photographer',
  videographer: 'Videographer',
  printer: 'Printer',
  software: 'Software',
  agency: 'Agency',
  logistics: 'Logistics',
  other: 'Other',
};

export function VendorDetailTabs({ vendor }: { vendor: Vendor }) {
  const tabs: UrlTab[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'bills', label: 'Bills' },
    { value: 'transactions', label: 'Transactions' },
    { value: 'ledger', label: 'Ledger' },
    { value: 'documents', label: 'Documents', count: vendor.documentsCount },
    { value: 'contracts', label: 'Contracts', count: vendor.contractsCount },
    { value: 'activity', label: 'Activity' },
  ];
  return (
    <UrlTabs tabs={tabs} defaultTab="overview">
      {{
        overview: <OverviewTab vendor={vendor} />,
        bills: <VendorBillsSection vendorId={vendor.id} vendorName={vendor.name} />,
        transactions: <VendorPaymentsSection vendorId={vendor.id} vendorName={vendor.name} />,
        ledger: <LedgerTab vendor={vendor} />,
        documents: (
          <DocumentsSection entityType="vendor" entityId={vendor.id} entityName={vendor.name} />
        ),
        contracts: <ContractsTab vendor={vendor} />,
        activity: <ActivityTab />,
      }}
    </UrlTabs>
  );
}

function OverviewTab({ vendor }: { vendor: Vendor }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Vendor details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Category" value={CATEGORY_LABELS[vendor.category]} />
            <Detail label="City" value={vendor.city} />
            <Detail
              label="GSTIN"
              value={vendor.gstin ?? <span className="text-muted-foreground">—</span>}
              mono
            />
            <Detail
              label="PAN"
              value={vendor.pan ?? <span className="text-muted-foreground">—</span>}
              mono
            />
            <Detail
              label="TDS section"
              value={
                vendor.tdsSection === 'none' ? (
                  <span className="text-muted-foreground">Not applicable</span>
                ) : (
                  <span className="font-mono">{vendor.tdsSection}</span>
                )
              }
            />
            <Detail
              label="Contact"
              value={
                vendor.contactName ? (
                  <span>
                    {vendor.contactName}
                    {vendor.contactPhone ? (
                      <>
                        <br />
                        <span className="text-muted-foreground tabular-nums">
                          {vendor.contactPhone}
                        </span>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outstanding</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums">
            {formatINR(vendor.outstandingPaise)}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Captured from invoices — not computed.
          </p>
          {vendor.notes ? (
            <p className="text-muted-foreground mt-4 text-sm whitespace-pre-wrap">{vendor.notes}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function LedgerTab({ vendor }: { vendor: Vendor }) {
  const onNavigate = useEntityNavigate();
  return <TransactionList transactions={[]} entityName={vendor.name} onNavigate={onNavigate} />;
}

function ContractsTab({ vendor }: { vendor: Vendor }) {
  // Contracts are a sub-view of documents filtered to kind=contract / msa.
  return <DocumentList documents={[]} entityName={vendor.name} />;
}

function ActivityTab() {
  const onNavigate = useEntityNavigate();
  return <ActivityFeed events={[]} onNavigate={onNavigate} showHeader={false} />;
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  );
}
