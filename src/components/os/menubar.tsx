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
}: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
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

  const time = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  const items: Record<string, MenuItem[]> = {
    File: [
      {
        label: 'New Window',
        shortcut: '⌘N',
        live: true,
        action: () => onAction('open', activeApp?.id),
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
      { label: 'Apār One Guide' },
      { label: 'Keyboard Shortcuts', shortcut: '⌘/' },
      { label: "What's New" },
    ],
  };

  return (
    <div className="menubar">
      <div className="wordmark">अपār</div>
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
                  <div
                    key={i}
                    className={`row ${'live' in it && it.live ? 'live' : ''}`}
                    onClick={() => {
                      if ('action' in it) it.action?.();
                      setOpen(null);
                    }}
                  >
                    <span>{'label' in it ? it.label : ''}</span>
                    {'shortcut' in it && it.shortcut ? (
                      <span
                        style={{
                          color: 'var(--text-dim)',
                          fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
                          fontSize: 11,
                        }}
                      >
                        {it.shortcut}
                      </span>
                    ) : null}
                  </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
          <Icon name="search" size={13} />
          <Icon name="bell" size={13} />
        </div>
        <div className="clock">
          {date} · {time}
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
          <div className="avatar" style={{ background: user.tone }}>
            {initials(user.fullName)}
          </div>
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
                    fontFamily: "var(--font-jetbrains-mono), 'JetBrains Mono', monospace",
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
