'use client';

import { useEffect, useState } from 'react';
import { HandshakeIcon, PlusIcon, SendIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatINR } from '@/components/shared/format-inr';
import { PostTransactionDialog } from './post-transaction-dialog';
import { VendorBillForm } from './vendor-bill-form';
import {
  listVendorBillsForClient,
  listVendorBillsForVendor,
  type VendorBillRow,
} from '@/lib/server/entities/vendor-bills';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  pending_approval: 'warning',
  posted: 'success',
  reversed: 'danger',
  void: 'neutral',
};

const ATTRIBUTION_TONE: Record<string, 'info' | 'warning' | 'neutral'> = {
  client: 'info',
  opex: 'warning',
  asset: 'neutral',
};

/**
 * "Expenses on behalf" section for the CLIENT profile. Lists vendor bills
 * where on_behalf_of_client_id = this client AND attribution = client. The
 * "Record expense" button opens the shared VendorBillForm with attribution
 * locked to 'client' and this client pre-filled.
 */
export function ClientExpensesOnBehalfSection({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [rows, setRows] = useState<readonly VendorBillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [posting, setPosting] = useState<{ id: string; ref: string } | null>(null);

  async function reload() {
    try {
      const data = await listVendorBillsForClient(clientId);
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bills');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listVendorBillsForClient(clientId)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load bills');
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (error) {
    return <EmptyState icon={HandshakeIcon} title="Could not load expenses" description={error} />;
  }
  if (rows === null) return <Skeleton className="h-32 w-full" />;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Expenses on behalf{' '}
            <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" aria-hidden />
            Record expense
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={HandshakeIcon}
              title="No expenses-on-behalf yet"
              description={`Click "Record expense" when Apar has paid a vendor for ${clientName}. The same record will appear under the vendor's Bills tab.`}
            />
          ) : (
            <BillsList
              rows={rows}
              onPost={(r) => setPosting({ id: r.id, ref: r.vendorInvoiceNumber ?? r.reference })}
            />
          )}
        </CardContent>
      </Card>

      <VendorBillForm
        open={formOpen}
        onOpenChange={setFormOpen}
        clientId={clientId}
        clientName={clientName}
        lockAttributionToClient
        onCreated={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <PostTransactionDialog
        transactionId={posting?.id ?? null}
        label={posting?.ref ?? ''}
        onOpenChange={(o) => !o && setPosting(null)}
        onPosted={() => {
          setPosting(null);
          void reload();
        }}
      />
    </>
  );
}

/**
 * Vendor-profile "Bills" section. Lists every vendor_bill paid to this
 * vendor (regardless of attribution). The "New bill" button opens the
 * shared VendorBillForm with the vendor pre-filled and the attribution
 * picker shown (client / opex / asset).
 */
export function VendorBillsSection({
  vendorId,
  vendorName,
}: {
  vendorId: string;
  vendorName: string;
}) {
  const [rows, setRows] = useState<readonly VendorBillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [posting, setPosting] = useState<{ id: string; ref: string } | null>(null);

  async function reload() {
    try {
      const data = await listVendorBillsForVendor(vendorId);
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bills');
    }
  }

  useEffect(() => {
    let cancelled = false;
    listVendorBillsForVendor(vendorId)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load bills');
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId]);

  if (error) {
    return <EmptyState icon={HandshakeIcon} title="Could not load bills" description={error} />;
  }
  if (rows === null) return <Skeleton className="h-32 w-full" />;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Bills <span className="text-muted-foreground text-xs font-normal">({rows.length})</span>
          </CardTitle>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" aria-hidden />
            New bill
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={HandshakeIcon}
              title="No bills from this vendor yet"
              description={`Record a new bill from ${vendorName}. Pick the attribution (for a client, OpEx, or asset) when creating.`}
            />
          ) : (
            <BillsList
              rows={rows}
              onPost={(r) => setPosting({ id: r.id, ref: r.vendorInvoiceNumber ?? r.reference })}
            />
          )}
        </CardContent>
      </Card>

      <VendorBillForm
        open={formOpen}
        onOpenChange={setFormOpen}
        vendorId={vendorId}
        vendorName={vendorName}
        onCreated={() => {
          setFormOpen(false);
          void reload();
        }}
      />

      <PostTransactionDialog
        transactionId={posting?.id ?? null}
        label={posting?.ref ?? ''}
        onOpenChange={(o) => !o && setPosting(null)}
        onPosted={() => {
          setPosting(null);
          void reload();
        }}
      />
    </>
  );
}

function BillsList({
  rows,
  onPost,
}: {
  rows: readonly VendorBillRow[];
  onPost?: (row: VendorBillRow) => void;
}) {
  return (
    <ul className="divide-y">
      {rows.map((b) => (
        <li
          key={b.id}
          className="hover:bg-muted/30 flex items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground font-mono text-xs">
                {b.vendorInvoiceNumber ?? b.reference}
              </span>
              <StatusBadge
                tone={STATUS_TONE[b.status] ?? 'neutral'}
                label={b.status.replace('_', ' ')}
                dot={false}
              />
              <StatusBadge
                tone={ATTRIBUTION_TONE[b.attribution] ?? 'neutral'}
                label={b.attribution}
                dot={false}
              />
              {b.flags.blocks > 0 ? (
                <StatusBadge tone="danger" label={`${b.flags.blocks} block`} dot={false} />
              ) : null}
              {b.flags.warnings > 0 ? (
                <StatusBadge tone="warning" label={`${b.flags.warnings} warn`} dot={false} />
              ) : null}
            </div>
            {b.description ? (
              <div className="text-muted-foreground text-xs">{b.description}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className="font-mono text-sm tabular-nums">{formatINR(b.amountPaise)}</div>
            <div className="text-muted-foreground text-xs">
              {new Date(b.txnDate).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </div>
            {b.status === 'draft' && onPost ? (
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onPost(b)}>
                <SendIcon className="mr-1 size-3" aria-hidden />
                Post
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
