import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CalendarDaysIcon,
  FileTextIcon,
  HomeIcon,
  ReceiptIcon,
  ScrollTextIcon,
  UserIcon,
} from 'lucide-react';

import { currentEmployee } from '@/lib/server/employee-auth';
import { SignOutButton } from './me/sign-out-button';

const PORTAL_NAV = [
  { href: '/me', label: 'Home', icon: HomeIcon },
  { href: '/me/leaves', label: 'Leaves', icon: CalendarDaysIcon },
  { href: '/me/reimbursements', label: 'Reimbursements', icon: ReceiptIcon },
  { href: '/me/payslips', label: 'Payslips', icon: ScrollTextIcon },
  { href: '/me/documents', label: 'My documents', icon: FileTextIcon },
  { href: '/me/profile', label: 'My profile', icon: UserIcon },
];

/**
 * Employee portal route group. Stripped UI: no sidebar with /clients, no
 * Cmd+K palette. This layout is the authoritative auth gate for /me/*: it
 * resolves the signed-in employee (Supabase-free session — see
 * employee-auth.ts) and redirects to /login when there is none. Middleware
 * does a fast cookie-presence pre-check; the real verification is here.
 *
 * This layout is separate from the (app) layout — the App Router's
 * route-group convention means /me/* paths render with portal chrome.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const employee = await currentEmployee();
  if (!employee) redirect('/login');

  const displayName = employee.displayName || employee.fullName;

  return (
    <div className="bg-background flex min-h-screen w-full">
      <aside className="bg-card sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/me" className="text-base font-semibold tracking-tight">
            Apar Self-service
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="space-y-1">
            {PORTAL_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm"
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="space-y-1 border-t p-3">
          <div className="px-2.5 pb-1">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {employee.workEmail ?? employee.employeeCode}
            </p>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 md:px-6">
          <p className="text-muted-foreground text-sm">
            Hi {displayName.split(' ')[0]} — this is your self-service space.
          </p>
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
