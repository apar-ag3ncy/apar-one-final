import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { AppError } from '@/lib/errors';
import { getTeamMemberProfile } from '@/lib/server/portal/team';

export const metadata: Metadata = { title: 'Apar · Teammate' };

function fmt(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function dayMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
  });
}

const ADDRESS_KIND: Record<string, string> = {
  registered: 'Registered',
  billing: 'Billing',
  shipping: 'Shipping',
  office: 'Office',
  home: 'Home',
  other: 'Other',
};

export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;

  let person;
  try {
    person = await getTeamMemberProfile(employeeId);
  } catch (e) {
    // A bad or separated-employee id is a 404, not a crash.
    if (e instanceof AppError && e.kind === 'not_found') notFound();
    throw e;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/me/team"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        Team
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {person.displayName ?? person.fullName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {person.designation ?? 'Team member'}
          {person.department ? ` · ${person.department}` : ''}
        </p>
        {person.isMe ? (
          <div className="mt-2">
            <StatusBadge tone="info" label="This is you" dot={false} />
          </div>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Basics</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Birthday" value={person.dateOfBirth ? dayMonth(person.dateOfBirth) : '—'} />
            <Detail label="With Apar since" value={fmt(person.joinedOn)} />
            <Detail label="Work email" value={person.workEmail ?? '—'} />
            <Detail label="Phone" value={person.phone ?? '—'} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {person.contacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No contacts on record.</p>
          ) : (
            <ul className="divide-y text-sm">
              {person.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.name}
                      {c.role ? (
                        <span className="text-muted-foreground font-normal"> · {c.role}</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {[c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {c.isPrimary ? <StatusBadge tone="neutral" label="Primary" dot={false} /> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Addresses</CardTitle>
        </CardHeader>
        <CardContent>
          {person.addresses.length === 0 ? (
            <p className="text-muted-foreground text-sm">No addresses on record.</p>
          ) : (
            <ul className="divide-y text-sm">
              {person.addresses.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p>{[a.line1, a.line2].filter(Boolean).join(', ')}</p>
                    <p className="text-muted-foreground text-xs">
                      {[a.city, a.stateCode, a.postalCode].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusBadge
                    tone="neutral"
                    label={ADDRESS_KIND[a.kind] ?? a.kind}
                    dot={false}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Achievements</CardTitle>
        </CardHeader>
        <CardContent>
          {person.achievements.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {person.achievements.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <span>{a.summary}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {new Date(a.at).toLocaleDateString('en-IN', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
