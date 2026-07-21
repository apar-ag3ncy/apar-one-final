'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  CalendarDaysIcon,
  HomeIcon,
  ListChecksIcon,
  LogOutIcon,
  MenuIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { signOutPortal } from '@/lib/server/portal/auth';

/**
 * Portal chrome: the four employee apps plus the personal profile.
 *
 * Mobile-first on purpose — employees mostly reach this on a phone to apply
 * for leave or check a task, so the sidebar collapses into a drawer rather
 * than simply disappearing (the previous scaffold's sidebar was `hidden
 * md:flex` with no mobile alternative, leaving phones with no navigation).
 */

const NAV = [
  { href: '/me', label: 'Home', icon: HomeIcon, exact: true },
  { href: '/me/tasks', label: 'Tasks', icon: ListChecksIcon },
  { href: '/me/attendance', label: 'Attendance', icon: CalendarDaysIcon },
  { href: '/me/team', label: 'Team', icon: UsersIcon },
  { href: '/me/profile', label: 'My profile', icon: UserIcon },
];

export function PortalShell({
  fullName,
  designation,
  isManager,
  children,
}: {
  fullName: string;
  designation: string | null;
  isManager: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isSigningOut, startSignOut] = useTransition();

  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  function handleSignOut() {
    startSignOut(async () => {
      await signOutPortal();
      router.replace('/sign-in');
      router.refresh();
    });
  }

  const navList = (
    <ul className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => setDrawerOpen(false)}
              aria-current={isActive(item) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                isActive(item)
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const identity = (
    <div className="border-t px-4 py-3">
      <p className="truncate text-sm font-medium">{fullName}</p>
      <p className="text-muted-foreground truncate text-xs">
        {designation ?? 'Team member'}
        {isManager ? ' · Manager' : ''}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-8 w-full justify-start px-2"
        onClick={handleSignOut}
        disabled={isSigningOut}
      >
        <LogOutIcon className="size-4" aria-hidden />
        {isSigningOut ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full">
      {/* Desktop sidebar */}
      <aside className="bg-card sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/me" className="text-base font-semibold tracking-tight">
            Apar
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">{navList}</nav>
        {identity}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="bg-card absolute top-0 left-0 flex h-full w-64 flex-col border-r shadow-lg">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="text-base font-semibold tracking-tight">Apar</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <XIcon className="size-4" aria-hidden />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">{navList}</nav>
            {identity}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <MenuIcon className="size-4" aria-hidden />
          </Button>
          <p className="text-muted-foreground truncate text-sm">
            {NAV.find(isActive)?.label ?? 'Home'}
          </p>
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
