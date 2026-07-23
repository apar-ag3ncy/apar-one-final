'use client';

import { useRef, useState } from 'react';

import { Icon, type IconName } from '@/components/os/icons';

/**
 * Magnifying dock for the employee OS — same look and feel as the admin dock
 * (`components/os/dock.tsx`): cursor-tracked magnification, hover tooltips and
 * a running-app indicator, reusing the shared `.dock*` os.css classes. Kept
 * self-contained (it does not import the admin Dock, which is typed to the
 * admin app registry) so the two shells stay independent.
 */

export type EmpDockApp = { key: string; name: string; icon: IconName };

const ITEM_SIZE = 50;
const ITEM_GAP = 12;
const DOCK_PADDING_LEFT = 10; // matches .dock { padding: 8px 10px }
const SIGMA = ITEM_SIZE * (70 / 48);

function itemCentre(i: number): number {
  return DOCK_PADDING_LEFT + i * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2;
}

export function EmployeeDock({
  apps,
  openKeys,
  onOpen,
}: {
  apps: readonly EmpDockApp[];
  openKeys: ReadonlySet<string>;
  onOpen: (key: string) => void;
}) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [tooltipFor, setTooltipFor] = useState<string | null>(null);

  return (
    <div className="dock-wrap">
      <div
        className="dock"
        ref={dockRef}
        style={{ gap: ITEM_GAP }}
        onMouseMove={(e) => {
          const r = dockRef.current?.getBoundingClientRect();
          if (r) setMouseX(e.clientX - r.left);
        }}
        onMouseLeave={() => {
          setMouseX(null);
          setTooltipFor(null);
        }}
      >
        {apps.map((a, i) => {
          let scale = 1;
          if (mouseX != null) {
            const d = Math.abs(mouseX - itemCentre(i));
            const factor = Math.max(0, 1 - d / SIGMA);
            scale = 1 + factor * factor * 0.6;
          }
          return (
            <div
              key={a.key}
              className="dock-item"
              style={{ width: ITEM_SIZE, height: ITEM_SIZE, transform: `scale(${scale})` }}
              onClick={() => onOpen(a.key)}
              onMouseEnter={() => setTooltipFor(a.key)}
              role="button"
              tabIndex={0}
              aria-label={a.name}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(a.key);
                }
              }}
            >
              <Icon name={a.icon} size={26} stroke={1.7} />
              {openKeys.has(a.key) ? <div className="indicator" /> : null}
              {tooltipFor === a.key ? <div className="dock-tooltip">{a.name}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
