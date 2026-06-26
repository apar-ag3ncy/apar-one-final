import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { VendorWizard } from './vendor-wizard';

export const metadata: Metadata = {
  title: 'New vendor · Apar Dashboard',
};

export default function NewVendorPage() {
  return (
    <>
      <ProfileHeader
        title="New vendor"
        subtitle="Seven steps. Contract status at step 5 gates creation server-side — pending vendors need a reason and an ETA within 30 days."
        back={{ href: '/vendors', label: 'All vendors' }}
      />
      <VendorWizard />
    </>
  );
}
