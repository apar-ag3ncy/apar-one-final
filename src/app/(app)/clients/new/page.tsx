import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { ClientWizard } from './client-wizard';

export const metadata: Metadata = {
  title: 'New client · Apār Dashboard',
};

export default function NewClientPage() {
  return (
    <>
      <ProfileHeader
        title="New client"
        subtitle="Seven steps. The contract upload at step 5 gates creation server-side — without a signed contract (or an explicit pending reason + date) the client cannot be saved."
        back={{ href: '/clients', label: 'All clients' }}
      />
      <ClientWizard />
    </>
  );
}
