'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [isPending, startTransition] = useTransition();

  // TODO(backend): replace with magic-link server action that calls Supabase Auth.
  const handleMagicLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) {
      toast.error('Enter your work email.');
      return;
    }
    startTransition(() => {
      toast.info('Magic-link wiring pending (Backend agent).');
    });
  };

  // TODO(backend): replace with Google OAuth redirect via Supabase Auth.
  const handleGoogle = () => {
    toast.info('Google sign-in wiring pending (Backend agent).');
  };

  return (
    <form onSubmit={handleMagicLink} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@apar.example"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isPending}
        />
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Sending link…' : 'Email me a magic link'}
      </Button>
      <div className="relative my-2">
        <Separator />
        <span className="bg-background text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 text-xs tracking-wide uppercase">
          or
        </span>
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>
        Continue with Google
      </Button>
    </form>
  );
}
