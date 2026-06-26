import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
import './os.css';

export const metadata: Metadata = {
  title: 'Apar One · Desktop Demo',
  description:
    'Demo-grade desktop OS shell for the Apar dashboard — sample data only, no real backend.',
};

export default function OsPage() {
  return <OsRoot />;
}
