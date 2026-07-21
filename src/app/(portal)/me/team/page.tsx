import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/shared/status-badge';
import { listTeam } from '@/lib/server/portal/team';
import { todayIST } from '@/lib/ist-date';

export const metadata: Metadata = { title: 'Apar · Team' };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** "12 Mar" — year omitted, since a birthday's year is not the point. */
function birthday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
}

/** True when the date-of-birth falls in the next 30 days (year-agnostic). */
function birthdaySoon(dob: string, today: string): boolean {
  const [, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const thisYear = Date.UTC(ty!, m! - 1, d!);
  const nextYear = Date.UTC(ty! + 1, m! - 1, d!);
  const now = Date.UTC(ty!, tm! - 1, td!);
  const upcoming = thisYear >= now ? thisYear : nextYear;
  return (upcoming - now) / 86_400_000 <= 30;
}

export default async function TeamPage() {
  const team = await listTeam();
  const today = todayIST();

  const byDepartment = new Map<string, typeof team>();
  for (const m of team) {
    const key = m.department?.trim() || 'Team';
    const list = byDepartment.get(key) ?? [];
    list.push(m);
    byDepartment.set(key, list);
  }
  const departments = [...byDepartment.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground text-sm">
          {team.length} {team.length === 1 ? 'person' : 'people'}. Tap someone to see their
          contact details, birthday and achievements.
        </p>
      </header>

      {departments.map(([dept, members]) => (
        <section key={dept}>
          <h2 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
            {dept}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {members.map((m) => (
              <Link key={m.employeeId} href={`/me/team/${m.employeeId}`}>
                <Card className="hover:border-foreground/20 h-full transition-colors">
                  <CardContent className="flex items-center gap-3 py-4">
                    <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {initials(m.displayName ?? m.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {m.displayName ?? m.fullName}
                        {m.isMe ? (
                          <span className="text-muted-foreground font-normal"> · you</span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {m.designation ?? 'Team member'}
                      </p>
                    </div>
                    {m.dateOfBirth && birthdaySoon(m.dateOfBirth, today) ? (
                      <StatusBadge
                        tone="accent"
                        label={`🎂 ${birthday(m.dateOfBirth)}`}
                        dot={false}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
