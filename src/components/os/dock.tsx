'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { WindowState } from '@/lib/os/store';
import { Icon } from './icons';
import type { AppDef, AppId, DockBounds } from './types';

type Props = {
  apps: readonly AppDef[];
  openWindows: readonly WindowState[];
  /** Pixel size of each item. Driven by per-user settings. */
  itemSize: number;
  /** Gap between items. Driven by per-user settings. */
  itemGap: number;
  onOpen: (id: AppId | 'trash') => void;
  onContext: (kind: 'quit' | 'all', app: AppDef) => void;
  registerBounds: (bounds: DockBounds) => void;
};

const DOCK_PADDING_LEFT = 10; // matches .dock { padding: 8px 10px }

// Centre of item `i` relative to the dock's inner-left edge, derived from
// layout constants rather than refs so we don't access refs during render.
function itemCentre(i: number, size: number, gap: number): number {
  return DOCK_PADDING_LEFT + i * (size + gap) + size / 2;
}

export function Dock({
  apps,
  openWindows,
  itemSize,
  itemGap,
  onOpen,
  onContext,
  registerBounds,
}: Props) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [tooltipFor, setTooltipFor] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; app: AppDef } | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Magnification radius scales with icon size so the bulge feels consistent.
  const sigma = itemSize * (70 / 48);
  const iconScale = itemSize / 48;

  // Register dock-item centres after layout so window-open animations can
  // fly in from the right icon. useLayoutEffect keeps bounds in sync with
  // size changes before paint.
  useLayoutEffect(() => {
    const bounds: DockBounds = {};
    for (const [id, el] of Object.entries(itemRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      bounds[id] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    registerBounds(bounds);
  }, [apps.length, itemSize, itemGap, registerBounds]);

  const onMove = (e: React.MouseEvent) => {
    if (!dockRef.current) return;
    const r = dockRef.current.getBoundingClientRect();
    setMouseX(e.clientX - r.left);
  };

  const runningSet = useMemo(() => new Set(openWindows.map((w) => w.app)), [openWindows]);

  const onRightClick = (e: React.MouseEvent, app: AppDef) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, app });
  };

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctx]);

  return (
    <div className="dock-wrap">
      <div
        className="dock"
        ref={dockRef}
        style={{ gap: itemGap }}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setMouseX(null);
          setTooltipFor(null);
        }}
      >
        {apps.map((app, i) => {
          let scale = 1;
          if (mouseX != null) {
            const d = Math.abs(mouseX - itemCentre(i, itemSize, itemGap));
            const factor = Math.max(0, 1 - d / sigma);
            scale = 1 + factor * factor * 0.6;
          }
          return (
            <div
              key={app.id}
              ref={(node) => {
                itemRefs.current[app.id] = node;
              }}
              className={`dock-item ${app.id === 'admin_console' ? 'brand' : ''}`}
              style={{ width: itemSize, height: itemSize, transform: `scale(${scale})` }}
              onClick={() => onOpen(app.id)}
              onContextMenu={(e) => onRightClick(e, app)}
              onMouseEnter={() => setTooltipFor(app.id)}
            >
              <Icon name={app.icon} size={Math.round(26 * iconScale)} stroke={1.7} />
              {runningSet.has(app.id) && <div className="indicator" />}
              {tooltipFor === app.id && <div className="dock-tooltip">{app.name}</div>}
            </div>
          );
        })}
        <div className="dock-sep" />
        <div
          className="dock-item"
          style={{ width: itemSize, height: itemSize }}
          onClick={() => onOpen('trash')}
        >
          <Icon name="trash" size={Math.round(24 * iconScale)} stroke={1.7} />
        </div>
      </div>
      {ctx && (
        <div
          className="dock-ctx"
          style={{ left: ctx.x, top: ctx.y - 130 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="row"
            onClick={() => {
              onOpen(ctx.app.id);
              setCtx(null);
            }}
          >
            Open
          </div>
          <div
            className="row"
            onClick={() => {
              onContext('quit', ctx.app);
              setCtx(null);
            }}
          >
            Quit {ctx.app.name}
          </div>
          <div
            className="row"
            onClick={() => {
              onContext('all', ctx.app);
              setCtx(null);
            }}
          >
            Show All Windows
          </div>
          <div className="row" style={{ color: 'var(--text-dim)' }}>
            Options ›
          </div>
        </div>
      )}
    </div>
  );
}
