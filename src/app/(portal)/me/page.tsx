import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDaysIcon, ListChecksIcon, UserIcon, UsersIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { requirePortalEmployee } from '@/lib/server/portal/session';

export const metadata: Metadata = { title: 'Apar · Home' };

/**
 * Personal home. Identity comes from the session — never from a route param —
 * so there is no id a visitor could swap to land on someone else's page.
 */
export default async function PortalHomePage() {
  const me = await requirePortalEmployee();
  const firstName = (me.displayName ?? me.fullName).split(' ')[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {firstName}</h1>
        <p className="text-muted-foreground text-sm">
          {me.designation ?? 'Team member'}
          {me.department ? ` · ${me.department}` : ''}
          {me.isManager ? ' · Manager' : ''}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Tile
          href="/me/tasks"
          icon={ListChecksIcon}
          title="My tasks"
          body="Everything assigned to you, grouped by client and project."
        />
        <Tile
          href="/me/attendance"
          icon={CalendarDaysIcon}
          title="Attendance & leave"
          body={
            me.isManager
              ? 'Apply for leave, track decisions, and review your team’s requests.'
              : 'Apply for leave and see your manager’s decision.'
          }
        />
        <Tile
          href="/me/team"
          icon={UsersIcon}
          title="Team"
          body="Find a teammate’s contact details, birthday and achievements."
        />
        <Tile
          href="/me/profile"
          icon={UserIcon}
          title="My profile"
          body="Your details, compensation status and KPIs."
        />
      </section>
    </div>
  );
}

function Tile({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: typeof ListChecksIcon;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="hover:border-foreground/20 h-full transition-colors">
        <CardContent className="flex items-start gap-3 py-4">
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">{body}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
