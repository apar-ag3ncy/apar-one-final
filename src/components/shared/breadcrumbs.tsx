'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { labelForSegment } from './nav-config';

type Crumb = {
  href: string;
  label: string;
  current: boolean;
};

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return [{ href: '/', label: 'Dashboard', current: true }];
  }
  const crumbs: Crumb[] = [{ href: '/', label: 'Dashboard', current: false }];
  let accumulated = '';
  segments.forEach((segment, index) => {
    accumulated += `/${segment}`;
    crumbs.push({
      href: accumulated,
      label: labelForSegment(accumulated, segment),
      current: index === segments.length - 1,
    });
  });
  return crumbs;
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);
  return (
    <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center', className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => (
          <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && (
              <ChevronRightIcon
                className="text-muted-foreground/60 size-3.5 shrink-0"
                aria-hidden
              />
            )}
            {crumb.current ? (
              <span
                aria-current="page"
                className="text-foreground truncate font-medium"
                title={crumb.label}
              >
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="text-muted-foreground hover:text-foreground truncate transition-colors"
                title={crumb.label}
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
