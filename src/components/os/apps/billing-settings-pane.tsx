'use client';

import { useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { BillingSettingsClient } from '@/app/(app)/settings/billing/billing-settings-client';
import { InvoiceFormatEditor } from '@/components/settings/invoice-format-editor';
import { listBankAccountsForSettings } from '@/lib/server/settings/company';
import type { CompanyBankAccountRow } from '@/lib/server/settings/company-data';

/**
 * Settings → Billing for the OS. Same surfaces as the dashboard
 * /settings/billing page: the agency's bank accounts (with the UPI field
 * that drives the invoice payment block) plus the dynamic invoice-format
 * editor. Data is fetched client-side via the read action; `onChanged`
 * refetches instead of router.refresh().
 */
export function BillingSettingsPane() {
  const [accounts, setAccounts] = useState<CompanyBankAccountRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    listBankAccountsForSettings()
      .then((rows) => {
        setAccounts(rows);
        setLoadError(null);
      })
      .catch(() => setLoadError('Could not load bank accounts.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return <div className="text-muted-foreground px-5 py-8 text-sm">{loadError}</div>;
  }
  if (accounts === null) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      <div>
        <h2 className="mb-1 text-sm font-medium">Bank accounts</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          Apār&apos;s own accounts. The primary account — and its UPI ID — print on every invoice&apos;s
          payment block.
        </p>
        <BillingSettingsClient accounts={accounts} onChanged={load} />
      </div>
      <div className="border-t pt-5">
        <InvoiceFormatEditor />
      </div>
    </div>
  );
}
