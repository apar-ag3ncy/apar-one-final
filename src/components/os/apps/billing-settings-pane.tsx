'use client';

import { useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { BillingSettingsClient } from '@/app/(app)/settings/billing/billing-settings-client';
import { listBankAccountsForSettings } from '@/lib/server/settings/company';
import type { CompanyBankAccountRow } from '@/lib/server/settings/company-data';

/**
 * Settings → Billing for the OS: the agency's bank accounts that drive the
 * invoice payment block. The dynamic invoice-format editor lives in its own
 * Settings → Invoice format section (SettingsApp), not here. Data is fetched
 * client-side via the read action; `onChanged` refetches instead of
 * router.refresh().
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
    <div className="p-5">
      <p className="text-muted-foreground mb-3 text-xs">
        Apar&apos;s own accounts. The primary account prints on every invoice&apos;s payment
        block. Edit how invoices look under Settings → Invoice format.
      </p>
      <BillingSettingsClient accounts={accounts} onChanged={load} />
    </div>
  );
}
