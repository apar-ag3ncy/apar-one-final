'use client';

// Tiny client-side hook for the current user shape. Calls the
// getCurrentUser server action via useEffect; caches per provider scope.
// Returns `null` while loading and on no-session.

import { useEffect, useState } from 'react';

import { getCurrentUser, type CurrentUser } from '@/lib/server-stub/entity-actions';

export function useCurrentUser(): {
  user: CurrentUser | null;
  isLoading: boolean;
  hasCapability: (cap: string) => boolean;
} {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasCapability = (cap: string): boolean => {
    if (!user) return false;
    if (user.role === 'partner') return true;
    return user.capabilities.includes(cap);
  };

  return { user, isLoading, hasCapability };
}
