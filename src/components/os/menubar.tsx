'use client';

import { useEffect, useState } from 'react';
import { initials } from './format';
import { Icon } from './icons';
import type { AppDef, AppId } from './types';
import type { User } from './auth/types';

type MenuItem =
  | { sep: true }
  | { sep?: false; label: string; shortcut?: string; live?: boolean; action?: () => void };

type Props = {
  activeApp: AppDef | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  onAction: (kind: 'open', id: AppId | undefined) => void;
  user: User;
  onSignOut: () => void;
  onCloseAll: () => void;
  hasOpenWindows: boolean;
  onOpenSearch: () => void;
};

export function MenuBar({
  activeApp,
  theme,
  toggleTheme,
  onAction,
  user,
  onSignOut,
  onCloseAll,
  hasOpenWindows,
  onOpenSearch,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // `now` stays `null` on the server + first client paint so the rendered
  // clock matches across hydration. The effect sets it on mount and then
  // polls every 30s. Without this, `useState(() => new Date())` produces a
  // different string between SSR and CSR and trips React error #418.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Deferred to the next frame (not a synchronous setState in the effect
    // body) so the null-clock hydration paint matches SSR.
    const update = () => setNow(new Date());
    const raf = requestAnimationFrame(update);
    const t = setInterval(update, 1000 * 30);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!open && !userMenuOpen) return;
    const click = () => {
      setOpen(null);
      setUserMenuOpen(false);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, [open, userMenuOpen]);

  const time = now
    ? now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '';
  const date = now ? now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';

  const items: Record<string, MenuItem[]> = {
    File: [
      {
        label: 'New Window',
        shortcut: '⌘N',
        live: activeApp != null,
        action: activeApp ? () => onAction('open', activeApp.id) : undefined,
      },
      { label: 'Open…', shortcut: '⌘O' },
      { label: 'Close Window', shortcut: '⌘W' },
      { sep: true },
      { label: 'Export…', shortcut: '⌘E' },
    ],
    Edit: [
      { label: 'Undo', shortcut: '⌘Z' },
      { label: 'Redo', shortcut: '⌘⇧Z' },
      { sep: true },
      { label: 'Cut', shortcut: '⌘X' },
      { label: 'Copy', shortcut: '⌘C' },
      { label: 'Paste', shortcut: '⌘V' },
    ],
    View: [
      { label: 'Show Sidebar', shortcut: '⌘⌥S' },
      { label: 'Show Toolbar', shortcut: '⌘⌥T' },
      { sep: true },
      {
        label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        live: true,
        action: toggleTheme,
      },
    ],
    Window: [
      { label: 'Minimize', shortcut: '⌘M' },
      { label: 'Zoom' },
      { sep: true },
      {
        label: 'Close All Windows',
        shortcut: '⌘⌥W',
        live: hasOpenWindows,
        action: hasOpenWindows ? onCloseAll : undefined,
      },
      { label: 'Bring All to Front' },
    ],
    Help: [
      { label: 'Apar One Guide' },
      { label: 'Keyboard Shortcuts', shortcut: '⌘/' },
      { label: "What's New" },
    ],
  };

  return (
    <div className="menubar">
      <div className="wordmark" aria-label="Apar">
        {/* Both wordmark variants are shipped; os.css toggles them on
            `.os-root[data-theme='dark']`. */}
        <img
          src="/brand/apar-orange.svg"
          alt="Apar"
          className="wordmark-img wordmark-img--light"
          draggable={false}
        />
        <img
          src="/brand/apar-white.svg"
          alt=""
          aria-hidden
          className="wordmark-img wordmark-img--dark"
          draggable={false}
        />
      </div>
      <span className="active-app">{activeApp?.name ?? 'Finder'}</span>
      {Object.keys(items).map((k) => (
        <div
          key={k}
          className={`mb-item ${open === k ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(open === k ? null : k);
            setUserMenuOpen(false);
          }}
          onMouseEnter={() => {
            if (open && open !== k) setOpen(k);
          }}
        >
          {k}
          {open === k && (
            <div className="mb-dropdown" onClick={(e) => e.stopPropagation()}>
              {items[k]!.map((it, i) =>
                'sep' in it && it.sep ? (
                  <hr key={i} />
                ) : (
                  (() => {
                    // Items without an `action` are not wired up — render them
                    // visibly disabled so the menu never shows a control that
                    // silently does nothing.
                    const enabled = 'action' in it && typeof it.action === 'function';
                    return (
                      <div
                        key={i}
                        className={`row ${'live' in it && it.live ? 'live' : ''}`}
                        aria-disabled={enabled ? undefined : true}
                        style={enabled ? undefined : { opacity: 0.38, cursor: 'default' }}
                        onClick={() => {
                          if (enabled && 'action' in it) it.action?.();
                          setOpen(null);
                        }}
                      >
                        <span>{'label' in it ? it.label : ''}</span>
                        {'shortcut' in it && it.shortcut ? (
                          <span
                            style={{
                              color: 'var(--text-dim)',
                              fontFamily: 'var(--os-font)',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: 11,
                            }}
                          >
                            {it.shortcut}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="right">
        {/* Close-all-apps quick action — visible when at least one window is open. */}
        <button
          type="button"
          className="menubar-action"
          title="Close all apps"
          aria-label="Close all apps"
          disabled={!hasOpenWindows}
          onClick={(e) => {
            e.stopPropagation();
            onCloseAll();
          }}
        >
          <Icon name="close" size={13} stroke={2.2} />
        </button>
        <button
          type="button"
          className="menubar-action"
          title="Search (⌘K)"
          aria-label="Open command palette"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSearch();
          }}
        >
          <Icon name="search" size={13} />
        </button>
        <div className="clock" suppressHydrationWarning>
          {now ? `${date} · ${time}` : ''}
        </div>
        {/* User chip — clickable, opens a small dropdown with sign out. */}
        <div
          className={`user-chip menubar-user ${userMenuOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setUserMenuOpen((v) => !v);
            setOpen(null);
          }}
        >
          {user.role === 'super_admin' || user.role === 'admin' ? (
            <div className="avatar avatar-mark" aria-label={user.fullName}>
              <img src="/brand/apar-orange-square.png" alt="" draggable={false} />
            </div>
          ) : (
            <div className="avatar" style={{ background: user.tone }}>
              {initials(user.fullName)}
            </div>
          )}
          <span>{user.fullName.split(' ')[0]}</span>
          {userMenuOpen && (
            <div className="mb-dropdown menubar-user-dropdown" onClick={(e) => e.stopPropagation()}>
              <div
                className="row"
                style={{ flexDirection: 'column', alignItems: 'flex-start', cursor: 'default' }}
              >
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{user.fullName}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>@{user.username}</span>
              </div>
              <hr />
              <div
                className="row live"
                onClick={() => {
                  setUserMenuOpen(false);
                  onSignOut();
                }}
              >
                <span>Sign out</span>
                <span
                  style={{
                    color: 'var(--text-dim)',
                    fontFamily: 'var(--os-font)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 11,
                  }}
                >
                  ⌘⇧Q
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
