import type { Metadata } from 'next';

import { ProfileHeader } from '@/components/entity/profile-header';
import { listCompanyBankAccounts } from '@/lib/server/settings/company-data';
import { InvoiceFormatEditor } from '@/components/settings/invoice-format-editor';
import { BillingSettingsClient } from './billing-settings-client';

export const metadata: Metadata = { title: 'Billing · Settings · Apar Dashboard' };

export default async function BillingSettingsPage() {
  const accounts = await listCompanyBankAccounts();
  return (
    <>
      <ProfileHeader
        title="Billing · Bank accounts"
        subtitle="Apar's own bank accounts. The primary account is offered first on invoices; add as many secondary accounts as you need."
        back={{ href: '/settings', label: 'Back to settings' }}
      />
      <BillingSettingsClient accounts={accounts} />
      <div className="mt-8 border-t pt-6">
        <InvoiceFormatEditor />
      </div>
    </>
  );
}
