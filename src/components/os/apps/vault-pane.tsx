'use client';

import { VaultBody } from '@/components/settings/vault';

/**
 * Settings → Vault. Same body as the dashboard /settings/vault page; the
 * component is self-contained (fetches status, holds the unlock password in
 * memory only), so closing the Settings window re-locks the vault.
 */
export function VaultPane() {
  return (
    <div className="p-5">
      <VaultBody />
    </div>
  );
}
