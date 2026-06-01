import Link from 'next/link';
import { Breadcrumbs } from './breadcrumbs';
import { CommandPaletteHost } from './command-palette-host';
import { MobileSidebar } from './mobile-sidebar';
import { SidebarNav } from './sidebar-nav';
import { UserMenu, type CurrentUser } from './user-menu';

// TODO(backend): replace with getCurrentUser() from @/lib/auth once Backend ships it.
const STUB_USER: CurrentUser = {
  fullName: 'Sample User',
  email: 'sample.user@apar.example',
  role: 'admin',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen w-full">
      <aside className="bg-card sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Apār Dashboard
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav />
        </div>
        <div className="text-muted-foreground border-t px-4 py-3 text-xs">Apār LLP · Mumbai</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:px-6">
          <MobileSidebar />
          <Breadcrumbs className="min-w-0 flex-1" />
          <div className="flex items-center gap-2">
            <CommandPaletteHost />
            <UserMenu user={STUB_USER} />
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
