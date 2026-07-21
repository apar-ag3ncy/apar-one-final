import { redirect } from 'next/navigation';

import { maybePortalEmployee } from '@/lib/server/portal/session';

import { PortalShell } from './portal-shell';

/**
 * The authenticated portal shell.
 *
 * This server-side guard is the real gate. `proxy.ts` only routes by hostname
 * — the installed Next docs are explicit that Proxy "should not be used as a
 * full session management or authorization solution", and proxy matchers also
 * gate Server Actions, so page-level checks can never be the only defence.
 * Every portal data function independently calls `requirePortalEmployee()`.
 */
export default async function PortalMeLayout({ children }: { children: React.ReactNode }) {
  const session = await maybePortalEmployee();
  if (!session) redirect('/sign-in');

  return (
    <PortalShell
      fullName={session.displayName ?? session.fullName}
      designation={session.designation}
      isManager={session.isManager}
    >
      {children}
    </PortalShell>
  );
}
