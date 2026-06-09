'use client';

import { useRouter } from 'next/navigation';

import { ClientEditDialog } from '@/components/os/apps/client-edit-dialog';
import type { Client } from '@/components/clients/types';

/**
 * Dashboard wrapper around the shared ClientEditDialog. Server detail pages
 * can't pass a function across the RSC boundary, so this client wrapper
 * supplies `onSaved={router.refresh}` to reload the page after a save.
 */
export function ClientEditButton({ client }: { client: Client }) {
  const router = useRouter();
  return <ClientEditDialog client={client} onSaved={() => router.refresh()} />;
}
