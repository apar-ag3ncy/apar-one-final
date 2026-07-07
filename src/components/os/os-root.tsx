'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { APP_REGISTRY, isPortalOnlyRole } from '@/lib/os/app-registry';
import { osActions, useOsStore, type WindowState } from '@/lib/os/store';
import { useWindowUrlSync } from '@/lib/url/per-window-nuqs';
import { AdminConsole } from './auth/admin-console';
import { EntityMutationGate } from './auth/entity-mutation-gate';
import { LockScreen } from './auth/lock-screen';
import { useAuth, SUPER_ADMIN_USER_ID } from './auth/store';
import { can } from './auth/types';
import { useUserSettings, type UserSettings } from './auth/session-store';
import { useVendorStore } from './auth/vendor-store';
import { CommandPalette } from './command-palette';
import { useBusinessData } from './data-store';
import { APPS } from './data';
import { Dock } from './dock';
import { MenuBar } from './menubar';
import { Window } from './window';
import {
  ClientsApp,
  EmployeesApp,
  ProjectsApp,
  ReportsApp,
  SettingsApp,
  VendorsApp,
} from './apps';
// Phase 4 windows live as separate files so apps.tsx stops growing.
import { LedgerWindow } from './apps/ledger-window';
import { TransactionDetailWindow } from './apps/transaction-detail-window';
import { DocumentWindow } from './apps/document-window';
import { BankReconWindow } from './apps/bank-recon-window';
import { EmployeeWindow } from './apps/employee-window';
import { ClientWindow } from './apps/client-window';
import { ProjectWindow } from './apps/project-window';
import { VendorWindow } from './apps/vendor-window';
import { AttendanceApp } from './apps/attendance-app';
import { PerClientPnLWindow } from './apps/per-client-pnl-window';
import {
  AccountStatementWindow,
  parseAccountStatementRoute,
} from './apps/account-statement-window';
import { AppLauncher } from './apps/app-launcher';
import { TrashPane } from './apps/trash-pane';
import { AccountsOverviewWindow } from './apps/accounts-overview-window';
import { TrialBalanceWindow } from './apps/trial-balance-window';
import { BalanceSheetWindow } from './apps/balance-sheet-window';
import { PnLWindow } from './apps/pnl-window';
import { AgingWindow } from './apps/aging-window';
import { StatementWindow } from './apps/statement-window';
import { CashFlowWindow } from './apps/cash-flow-window';
import { BankBookWindow } from './apps/bank-book-window';
import { CombinedBankBookWindow } from './apps/combined-bank-book-window';
import { DayBookWindow } from './apps/day-book-window';
import { GstSummaryWindow } from './apps/gst-summary-window';
import { SalesRegisterWindow, PurchaseRegisterWindow } from './apps/register-window';
import { ProjectPnlWindow } from './apps/project-pnl-window';
import { TdsSummaryWindow } from './apps/tds-summary-window';
import { OfficeLedgerWindow } from './apps/office-ledger-window';
import { OfficeUtilitiesWindow } from './apps/office-utilities-window';
import { TdsBookWindow } from './apps/tds-book-window';
import { SalaryBookWindow } from './apps/salary-book-window';
import { ClientLedgerWindow } from './apps/client-ledger-window';
import { VendorLedgerWindow } from './apps/vendor-ledger-window';
import { OfficeApp } from './apps/office-app';
import type { AppDef, AppId, Client, CmdAction, DockBounds, Vendor } from './types';

export function OsRoot() {
  const { currentUser, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // SPEC-AMENDMENT-001 §8.2 — employees do NOT get the OS. They live in
  // Dashboard's `/me` portal. The check is keyed off the user's role
  // string; today's OS demo role enum only emits super_admin/admin/user
  // so this is dormant until A's RBAC swap lands `employee`. When the
  // /me route also exists (B's territory), the redirect actually fires.
  useEffect(() => {
    if (currentUser && isPortalOnlyRole(currentUser.role)) {
      router.replace('/me');
    }
  }, [currentUser, router]);

  // Mobile detection works the same whether signed in or not.
  const mobile = useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    () => window.innerWidth < 900,
    () => false,
  );

  // Hide page scroll while we're actually under /os. The pathname dep
  // re-runs cleanup if a future sub-route inside the (os) group keeps
  // OsRoot mounted across navigation, and the explicit guard prevents a
  // hijack from leaking if anything ever renders this outside /os.
  useEffect(() => {
    if (!pathname?.startsWith('/os')) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pathname]);

  if (mobile) {
    return (
      <div className="os-root">
        <div className="mobile-fallback">
          <div className="inner">
            <img
              src="/brand/apar-white.svg"
              alt="Apar"
              className="mobile-fallback-logo"
              draggable={false}
            />
            <p>
              Apar One is a desktop workspace. Please open this on a screen at least 1024px wide for
              the full experience.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Gate the desktop behind sign-in.
  if (!currentUser) {
    return (
      <div className="os-root">
        <LockScreen />
      </div>
    );
  }

  // Key Desktop on the user id so signing out + back in (or as a different
  // user) cleanly remounts and re-runs lazy init from the right snapshot.
  return <Desktop key={currentUser.id} signOut={signOut} />;
}

/* -------------------------------------------------------------------------- */
/* Desktop — only mounted once a user is signed in.                           */
/* -------------------------------------------------------------------------- */

function Desktop({ signOut }: { signOut: () => void }) {
  const { currentUser, updateSuperAdmin, updateUser } = useAuth();
  const user = currentUser!;

  // Keep the OS session's display name in step with an Account save (which
  // writes the real users table). Super admin's record is edited via its own
  // path; everyone else through updateUser.
  const setDisplayName = useCallback(
    (fullName: string) => {
      if (user.id === SUPER_ADMIN_USER_ID) {
        updateSuperAdmin({ fullName });
      } else {
        updateUser(user.id, { fullName });
      }
    },
    [user.id, updateSuperAdmin, updateUser],
  );

  // Per-user settings (theme, dock size, dock gap, accent, default app).
  const { settings, setSettings, resetSettings, settingsLoaded } = useUserSettings(user.id);
  // Per-user vendor data (vendors + invoices + documents).
  const vendorStore = useVendorStore(user.id);
  // Business data (clients/projects/employees/...) — looked up by entityId
  // when rendering detail windows so Rule 47 holds: the window stores ids,
  // the renderer resolves the entity from the live store.
  const { data: businessData } = useBusinessData();
  const { theme, dockItemSize, dockGap } = settings;
  const setTheme = useCallback(
    (next: UserSettings['theme'] | ((t: UserSettings['theme']) => UserSettings['theme'])) => {
      setSettings({ theme: typeof next === 'function' ? next(theme) : next });
    },
    [setSettings, theme],
  );

  // Pull window state out of the shared store. Selector keeps the cheap
  // tuple stable so unrelated updates (e.g. theme changes) don't churn.
  const windows = useOsStore((s) => s.windows);
  const focusedId = useOsStore((s) => s.focusedId);

  // Single source of truth for "may this user view this app". Used by the
  // dock/palette filters, the openApp gate, the URL-restore filter, and the
  // renderBody belt-and-braces guard so no path can surface a forbidden app.
  const canViewApp = useCallback((appId: AppId) => can(user, appId, 'view'), [user]);

  // URL ↔ store sync (replaces the localStorage session snapshot). Gated so a
  // pasted `?windows=…` link can't restore an app the operator didn't grant.
  useWindowUrlSync({ canView: canViewApp });

  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [dockBounds, setDockBounds] = useState<DockBounds>({});
  const [showHint, setShowHint] = useState(() => windows.length === 0);

  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(() => setShowHint(false), 7500);
    return () => clearTimeout(t);
  }, [showHint]);

  // Cmd+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
      if (e.key === 'Escape') setCmdkOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Propagate the OS theme into <html class="dark"> so Radix-portaled
  // content (Dialogs, Popovers, DropdownMenus) — which mounts at document
  // body, outside .os-root — also picks up shadcn's dark palette.
  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    return () => {
      // Strip the class when leaving the OS page so the Dashboard's light
      // theme isn't poisoned by a leftover `.dark` on html.
      html.classList.remove('dark');
    };
  }, [theme]);

  // Apps this user is allowed to see. Dock-side capability gate first
  // (`APP_REGISTRY.showInDock`), then the legacy `can(user, app, 'view')`
  // matrix. Portal-only roles (employee) get nothing — the useEffect above
  // redirects them to /me, this is the belt-and-braces hide for the first
  // paint before the redirect lands.
  const visibleApps = useMemo<readonly AppDef[]>(
    () =>
      isPortalOnlyRole(user.role)
        ? []
        : APPS.filter((a) => APP_REGISTRY[a.id]?.showInDock && can(user, a.id, 'view')),
    [user],
  );

  /* ---- Window-action wrappers ------------------------------------------- */
  // Thin closures so call sites don't import `osActions` directly. Each
  // wrapper respects the legacy capability check before reaching the store.

  const openApp = useCallback(
    (
      appId: AppId,
      opts: {
        entityId?: string;
        tab?: string;
        title?: string;
        width?: number;
        height?: number;
        position?: 'center' | 'cascade' | 'beside-focused';
        alwaysNew?: boolean;
      } = {},
    ): string | null => {
      if (!can(user, appId, 'view')) return null;
      const reg = APP_REGISTRY[appId];
      const size = reg?.defaultSize ?? { width: 880, height: 580 };
      return osActions.openWindow({
        app: appId,
        entityId: opts.entityId,
        tab: opts.tab,
        title: opts.title ?? APPS.find((a) => a.id === appId)?.name ?? appId,
        width: opts.width ?? size.width,
        height: opts.height ?? size.height,
        position: opts.position ?? 'center',
        alwaysNew: opts.alwaysNew,
      });
    },
    [user],
  );

  // Auto-open the user's saved "default landing app" once on login (after the
  // DB-backed settings have hydrated), if set, valid, and nothing is open yet.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !settingsLoaded) return;
    autoOpenedRef.current = true;
    const appId = settings.defaultLandingApp;
    if (!appId || windows.length > 0) return;
    if (visibleApps.some((a) => a.id === appId)) {
      openApp(appId as AppId);
    }
  }, [settingsLoaded, settings.defaultLandingApp, windows.length, visibleApps, openApp]);

  // Entity-detail openers. Each calls `openApp` with `position:
  // 'beside-focused'` so a click on an `<EntityRef>` inside one window
  // opens the referenced entity to the right — the multi-window
  // superpower called out in the brief.
  const openClientDetail = useCallback(
    (client: Client) => {
      openApp('clients', {
        entityId: client.id,
        title: `${client.name} — Client`,
        width: 760,
        height: 560,
        position: 'beside-focused',
      });
    },
    [openApp],
  );

  const openVendorDetail = useCallback(
    (vendor: Vendor) => {
      openApp('vendors', {
        entityId: vendor.id,
        title: `${vendor.name} — Vendor`,
        width: 820,
        height: 580,
        position: 'beside-focused',
      });
    },
    [openApp],
  );

  // Open a report inside the OS (native window) instead of a new browser tab.
  // Routes through `openApp` so the reports.view capability check still runs;
  // the per-slug body is dispatched in renderBody()'s `case 'reports'`.
  const openReport = useCallback(
    (slug: string, label: string) => {
      openApp('reports', { entityId: slug, title: label, position: 'beside-focused' });
    },
    [openApp],
  );

  const visibleWindows = windows.filter((w) => !w.isMinimized);
  const activeWindow: WindowState | null = focusedId
    ? (visibleWindows.find((w) => w.id === focusedId) ?? null)
    : visibleWindows.reduce<WindowState | null>((m, w) => (m && m.zIndex > w.zIndex ? m : w), null);
  const activeApp: AppDef | null = activeWindow
    ? (APPS.find((a) => a.id === activeWindow.app) ?? null)
    : null;

  // Command palette actions.
  const actions = useMemo<readonly CmdAction[]>(() => {
    const list: CmdAction[] = visibleApps.map((a) => ({
      icon: a.icon,
      label: `Open ${a.name}`,
      hint: 'App',
      run: () => openApp(a.id),
    }));
    list.push({
      icon: 'palette',
      label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      hint: 'Theme',
      run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    });
    // Deep-links straight into Settings sub-sections, so the invoice format
    // editor and bank accounts are reachable from ⌘K — not just by digging
    // through the Settings sidebar. Both are admin-tier panes, so only offer
    // them when the user actually has settings edit (otherwise the deep-link
    // would land on an access-denied pane).
    if (can(user, 'settings', 'edit')) {
      list.push({
        icon: 'filetext',
        label: 'Invoice format',
        hint: 'Settings',
        run: () => openApp('settings', { tab: 'Invoice format' }),
      });
      list.push({
        icon: 'book',
        label: 'Bank accounts',
        hint: 'Settings',
        run: () => openApp('settings', { tab: 'Bank accounts' }),
      });
    }
    if (can(user, 'clients', 'edit')) {
      list.push({
        icon: 'plus',
        label: 'New Client',
        hint: 'Action',
        run: () => openApp('clients'),
      });
    }
    if (can(user, 'vendors', 'edit')) {
      list.push({
        icon: 'plus',
        label: 'New Vendor',
        hint: 'Action',
        run: () => openApp('vendors'),
      });
    }
    if (can(user, 'projects', 'edit')) {
      list.push({
        icon: 'plus',
        label: 'New Project',
        hint: 'Action',
        run: () => openApp('projects'),
      });
    }
    if (can(user, 'ledger', 'view')) {
      list.push({
        icon: 'book',
        label: 'Jump to Ledger',
        hint: 'Finance',
        run: () => openApp('ledger'),
      });
      list.push({
        icon: 'book',
        label: 'Office ledger',
        hint: 'Finance',
        run: () => openApp('ledger', { entityId: 'office', title: 'Office ledger' }),
      });
      list.push({
        icon: 'book',
        label: 'Office utilities ledger',
        hint: 'Finance',
        run: () =>
          openApp('ledger', {
            entityId: 'office-utilities',
            title: 'Office utilities ledger',
          }),
      });
      list.push({
        icon: 'book',
        label: 'Bank Reconciliation',
        hint: 'Finance',
        run: () => openApp('bank_recon'),
      });
    }
    if (can(user, 'reports', 'view')) {
      // All reports open as native OS windows (renderBody's `case 'reports'`
      // dispatches the per-slug body) instead of a new browser tab.
      const reportActions: ReadonlyArray<{ slug: string; label: string }> = [
        { slug: 'trial-balance', label: 'Trial Balance' },
        { slug: 'balance-sheet', label: 'Balance Sheet' },
        { slug: 'pnl', label: 'Profit & Loss' },
        { slug: 'ar-aging', label: 'AR Aging' },
        { slug: 'ap-aging', label: 'AP Aging' },
        { slug: 'bank-book', label: 'Bank Book (per account)' },
        { slug: 'bank-book-combined', label: 'Bank Book (all accounts)' },
        { slug: 'day-book', label: 'Day Book' },
        { slug: 'gst-summary', label: 'GST Summary' },
        { slug: 'tds-summary', label: 'TDS Summary' },
        { slug: 'sales-register', label: 'Sales Register' },
        { slug: 'purchase-register', label: 'Purchase Register' },
        { slug: 'project-pnl', label: 'Per-Project P&L' },
        { slug: 'statement', label: 'Statement of Account' },
        { slug: 'per-client-pnl', label: 'Per-client P&L' },
        { slug: 'cash-flow', label: 'Cash Flow' },
      ];
      for (const r of reportActions) {
        list.push({
          icon: 'chart',
          label: r.label,
          hint: 'Report',
          run: () => openReport(r.slug, r.label),
        });
      }
      list.push({
        icon: 'book',
        label: 'Audit log',
        hint: 'Logs',
        run: () => {
          if (typeof window !== 'undefined') {
            window.open('/audit', '_blank', 'noopener,noreferrer');
          }
        },
      });
    }
    if (windows.length > 0) {
      list.push({
        icon: 'close',
        label: 'Close all apps',
        hint: 'Window',
        run: () => osActions.closeAllWindows(),
      });
    }
    list.push({
      icon: 'user',
      label: `Sign out (${user.fullName})`,
      hint: 'Session',
      run: () => signOut(),
    });
    return list;
  }, [visibleApps, theme, user, openApp, openReport, signOut, setTheme, windows.length]);

  // Resolve the detail entity for an entity-scoped window. Returns null
  // when the entity has been removed since the window was opened (e.g.
  // user deleted a client — we show a "no longer available" placeholder).
  function resolveEntity(w: WindowState): Client | Vendor | null {
    if (!w.entityId) return null;
    switch (w.app) {
      case 'clients':
        return businessData.clients.find((c) => c.id === w.entityId) ?? null;
      case 'vendors':
        return vendorStore.vendors.find((v) => v.id === w.entityId) ?? null;
      default:
        return null;
    }
  }

  function renderDetail(w: WindowState): React.ReactNode {
    // UUID-shaped entity ids come from the real DB (Cmd+K search,
    // cross-window EntityRef clicks). Route those to the new windows that
    // hit the real DB instead of the localStorage-backed legacy detail.
    // 8-4-4-4-12 v1-v8 UUID shape.
    if (
      w.entityId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(w.entityId)
    ) {
      const onClose = () => osActions.closeWindow(w.id);
      // Carry the OS user's edit/delete grant for this app into the detail
      // window so its (deeply nested, shared) entity sections render
      // read-only when the operator didn't grant edit/delete.
      const gate = (node: React.ReactNode) => (
        <EntityMutationGate
          canEdit={can(user, w.app, 'edit')}
          canDelete={can(user, w.app, 'delete')}
        >
          {node}
        </EntityMutationGate>
      );
      if (w.app === 'clients') {
        return gate(<ClientWindow clientId={w.entityId} onClose={onClose} />);
      }
      if (w.app === 'vendors') {
        return gate(<VendorWindow vendorId={w.entityId} onClose={onClose} />);
      }
      if (w.app === 'employees') {
        return gate(<EmployeeWindow employeeId={w.entityId} onClose={onClose} />);
      }
      if (w.app === 'projects') {
        return gate(<ProjectWindow projectId={w.entityId} onClose={onClose} />);
      }
    }

    const entity = resolveEntity(w);
    const recordGone = (
      <div
        className="main"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <div>
          This record is no longer available.
          <br />
          Close this window and try again from the list.
        </div>
      </div>
    );
    if (!entity) return recordGone;
    // Clients & vendors are always opened by their real DB UUID (handled above
    // by ClientWindow / VendorWindow). Reaching here means a stale, non-UUID
    // seed id whose legacy detail view only persisted to localStorage — never
    // render it (silent data-loss trap); show the unavailable state instead.
    if (w.app === 'clients' || w.app === 'vendors') return recordGone;
    return null;
  }

  return (
    <div
      // shadcn's design tokens (--card, --popover, --background, etc.) switch
      // on the `.dark` class. Mirror the OS theme into that class so any
      // Card / Dialog / Input / Button rendered inside the OS picks up the
      // dark palette instead of defaulting to light.
      className={`os-root ${theme === 'dark' ? 'dark' : ''}`}
      data-theme={theme}
      data-reduced-motion={settings.reducedMotion ? 'true' : undefined}
      style={{ '--accent': settings.accent } as CSSProperties}
    >
      <MenuBar
        activeApp={activeApp}
        theme={theme}
        toggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onAction={(kind, id) => {
          if (kind === 'open' && id) openApp(id);
        }}
        user={user}
        onSignOut={signOut}
        onCloseAll={() => osActions.closeAllWindows()}
        hasOpenWindows={windows.length > 0}
        onOpenSearch={() => setCmdkOpen(true)}
      />

      {/* Desktop icons removed — apps launch from the dock (or Cmd+K) only. */}

      {/* Windows */}
      {windows.map((w) => {
        if (w.isMinimized) return null;
        const renderBody = () => {
          // Defense in depth: never render an app body the user can't view,
          // no matter how the window entered the store — a pasted deep-link,
          // a stale snapshot, or a permission revoked after the window opened.
          // `openApp` blocks the normal path; this backstops every other one.
          if (!canViewApp(w.app)) {
            return (
              <div
                className="main"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 32,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                <div>
                  You don&apos;t have permission to view this app.
                  <br />
                  Ask the operator for access.
                </div>
              </div>
            );
          }
          // Phase-4 windows route directly — their bodies handle their own
          // entityId resolution against A's actions (once those land).
          if (w.app === 'transactions') {
            return <TransactionDetailWindow transactionId={w.entityId} />;
          }
          if (w.app === 'documents') {
            if (!w.entityId) {
              return (
                <div className="main" style={{ padding: 24, color: 'var(--text-muted)' }}>
                  No document id supplied.
                </div>
              );
            }
            return <DocumentWindow documentId={w.entityId} />;
          }
          if (w.app === 'bank_recon') {
            return <BankReconWindow bankAccountId={w.entityId} />;
          }
          // The 'ledger' and 'reports' apps use `entityId` as a routing key
          // (not an entity uuid lookup) — e.g. ledger 'office'/'client:<uuid>'
          // and reports 'trial-balance'/'statement'/etc. The employees app
          // additionally uses the 'directory' sentinel (launcher → team grid).
          // Skip the resolveEntity path (which would fall back to "no longer
          // available") — the switch below handles every routed shape natively.
          if (
            w.entityId &&
            w.app !== 'ledger' &&
            w.app !== 'reports' &&
            !(w.app === 'employees' && w.entityId === 'directory') &&
            !(w.app === 'office' && w.entityId === 'expenses')
          )
            return renderDetail(w);
          switch (w.app) {
            case 'clients':
              return (
                <div className="main">
                  <ClientsApp
                    openClient={openClientDetail}
                    canEdit={can(user, 'clients', 'edit')}
                    canDelete={can(user, 'clients', 'delete')}
                  />
                </div>
              );
            case 'vendors':
              return (
                <div className="main">
                  <VendorsApp
                    store={vendorStore}
                    openVendor={openVendorDetail}
                    canEdit={can(user, 'vendors', 'edit')}
                    canDelete={can(user, 'vendors', 'delete')}
                  />
                </div>
              );
            case 'projects':
              return (
                <div className="main">
                  <ProjectsApp
                    canEdit={can(user, 'projects', 'edit')}
                    canDelete={can(user, 'projects', 'delete')}
                  />
                </div>
              );
            case 'employees':
              // UUID entityIds are handled earlier by renderDetail() →
              // <EmployeeWindow>. Both a plain open and the Office launcher's
              // 'directory' sentinel land on the team grid — the old Team /
              // Attendance picker moved into the Office launcher.
              return (
                <div className="main">
                  <EmployeesApp
                    canEdit={can(user, 'employees', 'edit')}
                    canDelete={can(user, 'employees', 'delete')}
                  />
                </div>
              );
            case 'accounts': {
              const accountOptions = [
                can(user, 'clients', 'view')
                  ? {
                      app: 'clients' as const,
                      name: 'Clients',
                      desc: 'The client directory — invoices, receipts, projects, ledgers.',
                      icon: 'building' as const,
                      accent: '#E63A1F',
                    }
                  : null,
                can(user, 'vendors', 'view')
                  ? {
                      app: 'vendors' as const,
                      name: 'Vendors',
                      desc: 'The vendor directory — bills, payments, TDS, ledgers.',
                      icon: 'truck' as const,
                      accent: '#C46A28',
                    }
                  : null,
                can(user, 'ledger', 'view')
                  ? {
                      app: 'ledger' as const,
                      name: 'Ledgers',
                      desc: 'Every book — office cash & bank, per-client, per-vendor, TDS.',
                      icon: 'book' as const,
                      accent: '#5B6677',
                    }
                  : null,
                can(user, 'reports', 'view')
                  ? {
                      app: 'reports' as const,
                      name: 'Reports',
                      desc: 'Accounts Overview, P&L, balance sheet, GST & TDS, registers.',
                      icon: 'chart' as const,
                      accent: '#2E8F5A',
                    }
                  : null,
              ].filter((o) => o !== null);
              return (
                <AppLauncher
                  heading="Accounts"
                  sub="Pick where you're headed."
                  options={accountOptions}
                  onPick={(o) => {
                    openApp(o.app, { entityId: o.entityId, position: 'center' });
                    osActions.closeWindow(w.id);
                  }}
                />
              );
            }
            case 'attendance':
              return <AttendanceApp canEdit={can(user, 'attendance', 'edit')} />;
            case 'trash':
              return (
                <div className="main">
                  <div className="main-header">
                    <h2>Trash</h2>
                    <span className="sub">
                      deleted items stay recoverable for 30 days, then dispose automatically
                    </span>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <TrashPane />
                  </div>
                </div>
              );
            case 'office': {
              // The Office dock icon is a launcher: day-to-day expenses,
              // projects, the team directory and attendance all live inside.
              // 'expenses' (set by the launcher) opens the expense tracker.
              if (w.entityId === 'expenses') {
                return (
                  <div className="main">
                    <OfficeApp
                      canEdit={can(user, 'office', 'edit')}
                      canDelete={can(user, 'office', 'delete')}
                    />
                  </div>
                );
              }
              const canViewExpenses =
                user.role === 'super_admin' || (user.permissions.office?.view ?? false);
              const officeOptions = [
                canViewExpenses
                  ? {
                      app: 'office' as const,
                      entityId: 'expenses',
                      name: 'Expenses',
                      desc: 'Day-to-day office spend — pantry, rent, utilities, assets.',
                      icon: 'zap' as const,
                      accent: '#C46A28',
                    }
                  : null,
                can(user, 'projects', 'view')
                  ? {
                      app: 'projects' as const,
                      name: 'Projects',
                      desc: 'Every engagement — kanban, teams, tasks, budgets.',
                      icon: 'folder' as const,
                      accent: '#7A4E2D',
                    }
                  : null,
                can(user, 'employees', 'view')
                  ? {
                      app: 'employees' as const,
                      entityId: 'directory',
                      name: 'Team',
                      desc: 'The employee directory — profiles, compensation, documents.',
                      icon: 'users' as const,
                      accent: '#9B3826',
                    }
                  : null,
                can(user, 'attendance', 'view')
                  ? {
                      app: 'attendance' as const,
                      name: 'Attendance',
                      desc: 'The day-by-day attendance matrix, leaves and holidays.',
                      icon: 'check' as const,
                      accent: '#2E8F5A',
                    }
                  : null,
              ].filter((o) => o !== null);
              return (
                <AppLauncher
                  heading="Office"
                  sub="Pick where you're headed."
                  options={officeOptions}
                  onPick={(o) => {
                    openApp(o.app, { entityId: o.entityId, position: 'center' });
                    osActions.closeWindow(w.id);
                  }}
                />
              );
            }
            case 'ledger': {
              // Sub-routes on the 'ledger' app. The hub (no entityId)
              // lists every ledger we render; the others are focused
              // statement-of-account windows the hub opens beside.
              //   office              → cash + bank book
              //   office-utilities    → 6200 spend
              //   client:<uuid>       → per-client AR ledger
              //   vendor:<uuid>       → per-vendor AP ledger
              const eid = w.entityId;
              if (eid === 'office') {
                return <OfficeLedgerWindow />;
              }
              if (eid === 'office-utilities') {
                return <OfficeUtilitiesWindow />;
              }
              if (eid === 'salary-book') {
                return <SalaryBookWindow />;
              }
              if (eid === 'tds') {
                return <TdsBookWindow />;
              }
              if (eid && eid.startsWith('client:')) {
                return <ClientLedgerWindow clientId={eid.slice('client:'.length)} />;
              }
              if (eid && eid.startsWith('vendor:')) {
                return <VendorLedgerWindow vendorId={eid.slice('vendor:'.length)} />;
              }
              if (eid && eid.startsWith('account:')) {
                // Generic per-account drill-down (Accounts Overview → numbers).
                const parsed = parseAccountStatementRoute(eid);
                if (parsed) return <AccountStatementWindow {...parsed} />;
              }
              return <LedgerWindow />;
            }
            case 'reports': {
              // Each report renders natively inside the OS (no new browser
              // tab). The catalog (no entityId) lists them; a slug entityId
              // selects the report body. All share the live ledger actions.
              switch (w.entityId) {
                case undefined:
                case '':
                  return (
                    <div className="main">
                      <ReportsApp onOpenReport={openReport} />
                    </div>
                  );
                case 'accounts-overview':
                  return <AccountsOverviewWindow />;
                case 'trial-balance':
                  return <TrialBalanceWindow />;
                case 'balance-sheet':
                  return <BalanceSheetWindow />;
                case 'pnl':
                  return <PnLWindow />;
                case 'ar-aging':
                  return <AgingWindow side="receivable" />;
                case 'ap-aging':
                  return <AgingWindow side="payable" />;
                case 'statement':
                  return <StatementWindow />;
                case 'per-client-pnl':
                  return <PerClientPnLWindow />;
                case 'bank-book':
                  return <BankBookWindow />;
                case 'bank-book-combined':
                  return <CombinedBankBookWindow />;
                case 'day-book':
                  return <DayBookWindow />;
                case 'gst-summary':
                  return <GstSummaryWindow />;
                case 'sales-register':
                  return <SalesRegisterWindow />;
                case 'purchase-register':
                  return <PurchaseRegisterWindow />;
                case 'project-pnl':
                  return <ProjectPnlWindow />;
                case 'tds-summary':
                  return <TdsSummaryWindow />;
                case 'cash-flow':
                  return <CashFlowWindow />;
                default:
                  return (
                    <div className="main">
                      <ReportsApp onOpenReport={openReport} />
                    </div>
                  );
              }
            }
            case 'settings':
              return (
                <SettingsApp
                  // Re-key by tab so a deep-link command (e.g. "Invoice format")
                  // re-seeds the section even when reusing an open Settings window.
                  key={w.tab ?? 'general'}
                  settings={settings}
                  onSettingsChange={setSettings}
                  onResetSettings={resetSettings}
                  currentUserRole={user.role}
                  canEditSettings={can(user, 'settings', 'edit')}
                  onSignOut={signOut}
                  onDisplayNameChange={setDisplayName}
                  initialSection={w.tab}
                />
              );
            case 'admin_console':
              return <AdminConsole />;
            default:
              return (
                <div className="main">
                  <div style={{ padding: 24 }}>Empty</div>
                </div>
              );
          }
        };
        return (
          <Window
            key={w.id}
            win={w}
            isActive={activeWindow?.id === w.id}
            onFocus={() => osActions.focusWindow(w.id)}
            onClose={osActions.closeWindow}
            onMinimize={osActions.minimizeWindow}
            onMaximize={osActions.maximizeWindow}
            onMove={osActions.moveWindow}
            onResize={osActions.resizeWindow}
            dockBounds={dockBounds}
          >
            {renderBody()}
          </Window>
        );
      })}

      {/* Welcome hint — shows only on first paint after a clean sign-in. */}
      {showHint && windows.length === 0 && (
        <div className="welcome-hint">
          <div className="big">
            Welcome to{' '}
            <img
              src="/brand/apar-white.svg"
              alt="Apar"
              className="welcome-hint-wordmark"
              draggable={false}
            />{' '}
            One
          </div>
          <div>
            {visibleApps.length === 0 ? (
              <>You don&apos;t have access to any apps yet — ask the operator for permission.</>
            ) : (
              <>
                Double-click any desktop icon to launch an app,
                <br />
                or press <kbd>⌘</kbd> <kbd>K</kbd> to open the command palette.
              </>
            )}
          </div>
        </div>
      )}

      {/* Dock — sizing + spacing come from per-user settings. */}
      <Dock
        apps={visibleApps}
        openWindows={windows}
        itemSize={dockItemSize}
        itemGap={dockGap}
        onOpen={(id) => {
          if (id === 'trash') return;
          const min = windows.find((w) => w.app === id && w.isMinimized);
          if (min) {
            osActions.focusWindow(min.id);
            return;
          }
          openApp(id);
        }}
        onContext={(kind, app) => {
          if (kind === 'quit') {
            windows.filter((w) => w.app === app.id).forEach((w) => osActions.closeWindow(w.id));
          }
          if (kind === 'all') {
            const items = windows.filter((w) => w.app === app.id);
            items.forEach((w, i) => osActions.moveWindow(w.id, 100 + i * 40, 80 + i * 30));
            items.forEach((w) => osActions.focusWindow(w.id));
          }
        }}
        registerBounds={setDockBounds}
      />

      {cmdkOpen && <CommandPalette onClose={() => setCmdkOpen(false)} actions={actions} />}
    </div>
  );
}
