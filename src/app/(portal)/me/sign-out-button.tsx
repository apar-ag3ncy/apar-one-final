'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOutIcon } from 'lucide-react';
import { signOutEmployee } from '@/lib/server/employee-auth';

export function SignOutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const signOut = () => {
    startTransition(async () => {
      await signOutEmployee();
      router.replace('/login');
    });
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={isPending}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/40 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm disabled:opacity-60"
    >
      <LogOutIcon className="size-4" aria-hidden />
      {isPending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
