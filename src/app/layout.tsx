import type { Metadata } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apar Dashboard',
  description: 'Internal operations dashboard for Apar LLP.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Typography is unified on Apple's San Francisco system stack —
  // declared as `--font-sans` / `--font-mono` in `globals.css`. We
  // no longer load Geist webfonts: SF ships with macOS / iOS, and
  // every non-Apple surface falls back to `system-ui`.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full flex-col font-sans">
        <NuqsAdapter>
          <TooltipProvider delayDuration={150}>
            {children}
            <Toaster richColors closeButton />
          </TooltipProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
