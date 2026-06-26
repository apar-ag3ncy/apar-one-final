import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { FormsClient } from './forms-client';

export const metadata: Metadata = {
  title: 'Form Builder · Apar Dashboard',
};

export default function FormsPage() {
  return (
    <>
      <ProfileHeader
        title="Form Builder"
        subtitle="Custom fields per entity type. Locked rules: keys are immutable once data exists; type changes are forbidden once data exists; tightening required triggers a backfill flow."
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <FormsClient />
    </>
  );
}
