'use client';

import { useRouter } from 'next/navigation';

import { VendorEditDialog } from '@/components/os/apps/vendor-edit-dialog';
import type { Vendor } from '@/components/vendors/types';

/**
 * Dashboard wrapper around the shared VendorEditDialog. Server detail pages
 * can't pass a function across the RSC boundary, so this client wrapper
 * supplies `onSaved={router.refresh}` to reload the page after a save.
 */
export function VendorEditButton({ vendor }: { vendor: Vendor }) {
  const router = useRouter();
  return <VendorEditDialog vendor={vendor} onSaved={() => router.refresh()} />;
}
