'use client';

import { useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { CompanySettingsBody } from '@/components/settings/company-settings';
import { getCompanySettings, type CompanySettingsData } from '@/lib/server/settings/company';

/**
 * Settings → Company documents. Same body as the dashboard's
 * /settings/company page (profile with copyable statutory numbers +
 * the documents manager); here the data is fetched client-side via the
 * read action and `onChanged` refetches instead of router.refresh().
 */
export function CompanySettingsPane() {
  const [data, setData] = useState<CompanySettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    getCompanySettings()
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch(() => setLoadError('Could not load company details.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return <div className="text-muted-foreground px-5 py-8 text-sm">{loadError}</div>;
  }
  if (data === null) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (data.profile === null) {
    return (
      <div className="text-muted-foreground px-5 py-8 text-sm">
        No organization record found. Run <span className="font-mono">npm run db:seed</span> to
        create the company row, then reopen Settings.
      </div>
    );
  }
  return (
    <div className="p-5">
      <CompanySettingsBody profile={data.profile} documents={data.documents} onChanged={load} />
    </div>
  );
}
