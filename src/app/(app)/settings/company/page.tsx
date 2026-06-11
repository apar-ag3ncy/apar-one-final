import type { Metadata } from 'next';

import { ProfileHeader } from '@/components/entity/profile-header';
import { Card, CardContent } from '@/components/ui/card';
import { getCompanyProfile, listCompanyDocuments } from '@/lib/server/settings/company-data';
import { CompanySettingsClient } from '@/components/settings/company-settings';

export const metadata: Metadata = { title: 'Company details · Settings · Apār Dashboard' };

export default async function CompanySettingsPage() {
  const [profile, documents] = await Promise.all([getCompanyProfile(), listCompanyDocuments()]);

  return (
    <>
      <ProfileHeader
        title="Company details"
        subtitle="Apār's legal profile, statutory numbers, addresses, and documents — editable, copyable, and shared across invoices & reports."
        back={{ href: '/settings', label: 'Back to settings' }}
      />
      {profile ? (
        <CompanySettingsClient profile={profile} documents={documents} />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No organization record found. Run <span className="font-mono">npm run db:seed</span> to
            create the Apār company row, then reload.
          </CardContent>
        </Card>
      )}
    </>
  );
}
