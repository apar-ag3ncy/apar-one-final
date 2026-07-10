import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
import './os.css';

export const metadata: Metadata = {
  title: 'Apar One · Desktop Demo',
  description:
    'Demo-grade desktop OS shell for the Apar dashboard — sample data only, no real backend.',
};

// Server Actions invoked from the OS shell inherit this page's timeout budget
// (Next 16 route segment config — see maxDuration docs). The batched
// `importOfficeExpenses` is now a small constant number of round-trips, but this
// is a safety net for very large sheets (up to the 2000-row cap) so the function
// returns cleanly instead of being killed at the platform's short default.
export const maxDuration = 60;

export default function OsPage() {
  return <OsRoot />;
}
