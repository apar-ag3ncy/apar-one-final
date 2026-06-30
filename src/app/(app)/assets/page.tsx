import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { AssetsClient } from './assets-client';

export const metadata: Metadata = { title: 'Fixed assets · Apar Dashboard' };

export default function AssetsPage() {
  return (
    <>
      <ProfileHeader
        title="Fixed assets"
        subtitle="Your capitalised assets and their straight-line depreciation. Run depreciation to post the period charge (Dr Depreciation / Cr Accumulated Depreciation) to the ledger."
      />
      <AssetsClient />
    </>
  );
}
