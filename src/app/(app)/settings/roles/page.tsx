import type { Metadata } from 'next';
import { ProfileHeader } from '@/components/entity/profile-header';
import { RolesClient } from './roles-client';

export const metadata: Metadata = {
  title: 'Roles & capabilities · Apār Dashboard',
};

export default function RolesPage() {
  return (
    <>
      <ProfileHeader
        title="Roles & capabilities"
        subtitle={<>Partners only. Every grant or revoke writes to the audit log.</>}
        back={{ href: '/', label: 'Back to dashboard' }}
      />
      <RolesClient />
    </>
  );
}
