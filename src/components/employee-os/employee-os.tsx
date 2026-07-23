'use client';

// Standalone employee OS — a SEPARATE shell from the admin OS (/os). It reuses
// only presentational pieces (the Window chrome + os.css) and manages its own
// window state; it imports nothing from os-root / the admin store / os_users,
// so it can never affect or reach the admin OS. Rendered at /employee for a
// signed-in employee session only.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { WindowState } from '@/lib/os/store';
import { Window } from '@/components/os/window';
import { Icon, type IconName } from '@/components/os/icons';
import { signOutEmployee, type SafeEmployee } from '@/lib/server/employee-auth';
import { getMyPreferences, saveMyPreferences } from '@/lib/server/employee-portal';
import { MyTasksWindow, MyTeamWindow, MyAttendanceWindow, MyLeavesWindow } from './apps';
import { EmployeeDock } from './employee-dock';

type AppKey = 'tasks' | 'team' | 'attendance' | 'leaves';
type EmpApp = { key: AppKey; name: string; icon: IconName; w: number; h: number };

const EMP_APPS: readonly EmpApp[] = [
  { key: 'tasks', name: 'My Tasks', icon: 'check', w: 720, h: 560 },
  { key: 'team', name: 'Team', icon: 'users', w: 860, h: 580 },
  { key: 'attendance', name: 'My Attendance', icon: 'book', w: 780, h: 580 },
  { key: 'leaves', name: 'Leaves', icon: 'filetext', w: 860, h: 640 },
];

const APP_BLURB: Record<AppKey, string> = {
  tasks: 'What’s assigned to you, by client and project',
  team: 'Find a teammate’s contact, birthday and achievements',
  attendance: 'Your monthly attendance and exceptions',
  leaves: 'Apply for leave and track your manager’s decision',
};

// Our window state extends the OS WindowState with which employee app it hosts.
type EmpWin = WindowState & { empApp: AppKey };

let seq = 0;

function bodyFor(app: AppKey) {
  switch (app) {
    case 'tasks':
      return <MyTasksWindow />;
    case 'team':
      return <MyTeamWindow />;
    case 'attendance':
      return <MyAttendanceWindow />;
    case 'leaves':
      return <MyLeavesWindow />;
    default:
      return null;
  }
}

export function EmployeeOs({ employee }: { employee: SafeEmployee }) {
  const router = useRouter();
  // Lazy-init from the localStorage cache (instant, no flash); the effect below
  // reconciles with the account. Root has suppressHydrationWarning since the
  // cached theme can differ from the server's light default.
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      return localStorage.getItem(`apar-emp-theme:${employee.id}`) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [wins, setWins] = useState<EmpWin[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = employee.displayName || employee.fullName;

  // Reconcile the theme with the authoritative account value (employees.ui_prefs)
  // so it persists cross-device. Async only — no synchronous setState here.
  useEffect(() => {
    let cancelled = false;
    getMyPreferences()
      .then((p) => {
        if (cancelled || !p) return;
        if (p.theme === 'dark' || p.theme === 'light') setTheme(p.theme);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  // Mirror the theme onto <html> so portaled toasts pick up the dark palette;
  // lock page scroll while mounted. Both are restored on unmount.
  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') html.classList.add('dark');
    else html.classList.remove('dark');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      html.classList.remove('dark');
      document.body.style.overflow = prevOverflow;
    };
  }, [theme]);

  const applyTheme = (t: 'light' | 'dark') => {
    setTheme(t);
    try {
      localStorage.setItem(`apar-emp-theme:${employee.id}`, t);
    } catch {
      /* ignore */
    }
    void saveMyPreferences({ theme: t }).catch(() => {});
  };

  // Live clock — null on SSR/first paint to avoid a hydration mismatch.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const raf = requestAnimationFrame(tick);
    const iv = setInterval(tick, 15_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
  }, []);

  const focus = useCallback((id: string) => {
    seq += 1;
    const z = seq;
    setWins((cur) => cur.map((w) => (w.id === id ? { ...w, zIndex: z } : w)));
    setFocusedId(id);
  }, []);

  const openApp = useCallback((app: AppKey) => {
    setWins((cur) => {
      seq += 1;
      const z = seq;
      const existing = cur.find((w) => w.empApp === app);
      if (existing) {
        setFocusedId(existing.id);
        return cur.map((w) => (w.id === existing.id ? { ...w, isMinimized: false, zIndex: z } : w));
      }
      const def = EMP_APPS.find((a) => a.key === app);
      if (!def) return cur;
      const id = `w-${z}`;
      const n = cur.length;
      const win: EmpWin = {
        id,
        app: 'documents', // harmless — Window only uses app for a dock-origin fallback
        empApp: app,
        title: def.name,
        x: 130 + n * 34,
        y: 86 + n * 30,
        width: def.w,
        height: def.h,
        zIndex: z,
        isMinimized: false,
        isMaximized: false,
      };
      setFocusedId(id);
      return [...cur, win];
    });
  }, []);

  const close = (id: string) => setWins((cur) => cur.filter((w) => w.id !== id));
  const minimize = (id: string) =>
    setWins((cur) => cur.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)));
  const move = (id: string, x: number, y: number) =>
    setWins((cur) => cur.map((w) => (w.id === id ? { ...w, x, y } : w)));
  const resize = (id: string, width: number, height: number) =>
    setWins((cur) => cur.map((w) => (w.id === id ? { ...w, width, height } : w)));
  const maximize = (id: string) =>
    setWins((cur) =>
      cur.map((w) => {
        if (w.id !== id) return w;
        if (w.isMaximized && w.restore) {
          return { ...w, isMaximized: false, ...w.restore, restore: undefined };
        }
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        return {
          ...w,
          isMaximized: true,
          restore: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 30,
          width: vw,
          height: vh - 30 - 84,
        };
      }),
    );

  const signOut = () => {
    setSigningOut(true);
    void signOutEmployee().then(() => router.replace('/os'));
  };

  const time = now
    ? now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const activeWin = wins.find((w) => w.id === focusedId && !w.isMinimized) ?? null;

  return (
    <div
      className={`os-root ${theme === 'dark' ? 'dark' : ''}`}
      data-theme={theme}
      suppressHydrationWarning
    >
      <div className="menubar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.02em' }}>Apār</span>
          <span className="active-app">{activeWin ? activeWin.title : 'My Workspace'}</span>
        </div>
        <div className="right">
          <button
            type="button"
            className="mb-item"
            onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <span className="mb-item" style={{ pointerEvents: 'none', opacity: 0.85 }}>
            {displayName}
          </span>
          <button type="button" className="mb-item" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <span className="clock" suppressHydrationWarning>
            {time}
          </span>
        </div>
      </div>

      {wins.map((w) =>
        w.isMinimized ? null : (
          <Window
            key={w.id}
            win={w}
            isActive={focusedId === w.id}
            onFocus={() => focus(w.id)}
            onClose={close}
            onMinimize={minimize}
            onMaximize={maximize}
            onMove={move}
            onResize={resize}
            dockBounds={{}}
          >
            {bodyFor(w.empApp)}
          </Window>
        ),
      )}

      {wins.length === 0 ? (
        <div className="emp-home">
          <div className="emp-home__head">
            <div className="emp-home__hello">Welcome, {displayName.split(' ')[0]}</div>
            <div className="emp-home__sub">Your self-service workspace. Open an app to begin.</div>
          </div>
          <div className="emp-home__cards">
            {EMP_APPS.map((a) => (
              <button
                key={a.key}
                type="button"
                className="emp-card"
                onClick={() => openApp(a.key)}
              >
                <span className="emp-card__icon" aria-hidden>
                  <Icon name={a.icon} size={22} stroke={1.7} />
                </span>
                <span className="emp-card__name">{a.name}</span>
                <span className="emp-card__desc">{APP_BLURB[a.key]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <EmployeeDock
        apps={EMP_APPS}
        openKeys={new Set(wins.map((w) => w.empApp))}
        onOpen={(k) => openApp(k as AppKey)}
      />
    </div>
  );
}
