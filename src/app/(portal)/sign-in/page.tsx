import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { maybePortalEmployee } from '@/lib/server/portal/session';

import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in · Apar' };

export default async function PortalSignInPage() {
  // Already signed in — skip the form.
  const session = await maybePortalEmployee();
  if (session) redirect('/me');

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Apar</h1>
          <p className="text-muted-foreground text-sm">Employee portal</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
