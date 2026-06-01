import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
import './os.css';

export const metadata: Metadata = {
  title: 'Apār One · Desktop Demo',
  description:
    'Demo-grade desktop OS shell for the Apār dashboard — sample data only, no real backend.',
};

export default function OsPage() {
  return <OsRoot />;
}
