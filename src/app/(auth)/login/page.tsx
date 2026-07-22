import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { currentEmployee } from '@/lib/server/employee-auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in · Apar Self-service',
};

export default async function LoginPage() {
  // Already signed in → straight to the employee workspace.
  if (await currentEmployee()) redirect('/employee');

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Apar Self-service</CardTitle>
        <CardDescription>Sign in with your work email to view your portal.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
