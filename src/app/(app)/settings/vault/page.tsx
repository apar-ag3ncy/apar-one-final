import type { Metadata } from 'next';

import { ProfileHeader } from '@/components/entity/profile-header';
import { VaultBody } from '@/components/settings/vault';

export const metadata: Metadata = { title: 'Vault · Settings · Apar Dashboard' };

export default function VaultSettingsPage() {
  return (
    <>
      <ProfileHeader
        title="Vault"
        subtitle="Account IDs and passwords, encrypted with a vault password — nothing is viewable without it."
        back={{ href: '/settings', label: 'Back to settings' }}
      />
      <VaultBody />
    </>
  );
}
