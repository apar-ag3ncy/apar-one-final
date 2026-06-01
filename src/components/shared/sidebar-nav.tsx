'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, type NavItem } from './nav-config';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SidebarNavProps = {
  onNavigate?: () => void;
  className?: string;
};

export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <nav className={cn('flex flex-col gap-1', className)} aria-label="Primary">
      {NAV_ITEMS.map((item: NavItem) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0',
                active ? 'text-accent-foreground' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
