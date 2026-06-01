import { AppShell } from '@/components/shared/app-shell';

// Every authenticated page in (app) reads user-scoped DB data. Prerendering
// at build time would hit Supabase, which Vercel's build env can't reach.
export const dynamic = 'force-dynamic';

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
