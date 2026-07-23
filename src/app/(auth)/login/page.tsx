import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { currentEmployee } from '@/lib/server/employee-auth';

export const metadata: Metadata = {
  title: 'Sign in · Apar',
};

/**
 * Sign-in is unified at /os now — one entry that first asks which kind of
 * account is signing in (admin / employee / …) and then shows that account's
 * credential screen. This route just forwards there (or straight to the
 * employee workspace when a session already exists), so old /login links and
 * the sign-out redirect keep working.
 */
export default async function LoginPage() {
  if (await currentEmployee()) redirect('/employee');
  redirect('/os');
}
