import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in · Apār Dashboard',
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle className="text-2xl">Apār Dashboard</CardTitle>
        <CardDescription>
          Sign in to continue. We&apos;ll email you a one-time link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
