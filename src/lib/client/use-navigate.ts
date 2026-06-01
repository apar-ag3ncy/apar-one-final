'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import type { NavigationTarget } from '@/components/entity/types';
import { targetToUrl } from './navigation';

/**
 * Hook used by Dashboard call sites to satisfy the `onNavigate` prop on
 * shared `components/entity/*` components.
 *
 *   const onNavigate = useEntityNavigate();
 *   <EntityRef onNavigate={onNavigate} … />
 *
 * `useRouter` is only allowed in `components/` files OUTSIDE the entity tree
 * (per Rule 47). Centralising the bridge here keeps every Dashboard page
 * consistent and lets us swap the implementation (e.g. soft-navigation
 * vs hard reload for cross-app navigation) in one place.
 */
export function useEntityNavigate() {
  const router = useRouter();
  return useCallback(
    (target: NavigationTarget) => {
      router.push(targetToUrl(target));
    },
    [router],
  );
}
