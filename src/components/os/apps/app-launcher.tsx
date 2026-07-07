'use client';

// Launcher shell — the body of the consolidated dock apps ("Accounts",
// "Employees"). Opening the dock icon shows big tiles for the apps that live
// inside it; picking one opens that app in its own window and dismisses the
// launcher. The member apps keep their real ids, windows, permissions and
// deep links — this is purely the front door.

import type { AppId } from '../types';
import { Icon, type IconName } from '../icons';

export type LauncherOption = {
  app: AppId;
  /** Sub-route (window entityId) to open the member app with, if any. */
  entityId?: string;
  name: string;
  desc: string;
  icon: IconName;
  accent: string;
};

export function AppLauncher({
  heading,
  sub,
  options,
  onPick,
}: {
  heading: string;
  sub: string;
  options: readonly LauncherOption[];
  onPick: (option: LauncherOption) => void;
}) {
  return (
    <div
      className="main"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 22, gap: 16 }}
    >
      <header>
        <div className="font-display" style={{ fontSize: 20 }}>
          {heading}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          alignContent: 'start',
          flex: 1,
        }}
      >
        {options.map((o) => (
          <button
            key={`${o.app}:${o.entityId ?? ''}`}
            type="button"
            onClick={() => onPick(o)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 10,
              padding: 16,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--content-2)',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              minHeight: 130,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: 10,
                background: o.accent,
                color: '#fff',
              }}
            >
              <Icon name={o.icon} size={20} />
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{o.name}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              {o.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
