import type { Metadata } from 'next';
import { OsRoot } from '@/components/os/os-root';
import './os.css';

export const metadata: Metadata = {
  title: 'Apār One · Desktop Demo',
  description:
    'Demo-grade desktop OS shell for the Apār dashboard — sample data only, no real backend.',
};

// Server actions invoked from the OS (e.g. the invoice preview / send, which
// render PDFs with @react-pdf) can be slow on a cold serverless invocation —
// the first render takes ~20s. Give them headroom so a slow-but-valid render
// doesn't hit the platform's default function timeout and surface as a failure.
export const maxDuration = 60;

export default function OsPage() {
  return <OsRoot />;
}
