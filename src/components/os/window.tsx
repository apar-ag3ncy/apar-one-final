'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import type { WindowState } from '@/lib/os/store';
import { Icon } from './icons';
import type { DockBounds } from './types';

type Props = {
  win: WindowState;
  isActive: boolean;
  onFocus: () => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  dockBounds: DockBounds;
  children: ReactNode;
};

type DragStart = { x: number; y: number; wx: number; wy: number };
type ResizeStart = { x: number; y: number; w: number; h: number };

export function Window({
  win,
  isActive,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onMove,
  onResize,
  dockBounds,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [minimizing, setMinimizing] = useState(false);
  // `opening` is purely a CSS animation flag; it lives in the chrome so the
  // store's `WindowState` doesn't have to carry a transient field.
  const [opening, setOpening] = useState(true);
  const dragStart = useRef<DragStart | null>(null);
  const resizeStart = useRef<ResizeStart | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setOpening(false), 320);
    return () => clearTimeout(t);
  }, []);

  const onTitleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.tl') || target.closest('.tb-btn')) return;
    onFocus();
    if (win.isMaximized) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, wx: win.x, wy: win.y };
    e.preventDefault();
  };

  const onResizeMouseDown = (e: React.MouseEvent) => {
    onFocus();
    setResizing(true);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: win.width, h: win.height };
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    if (!dragging && !resizing) return;
    const onMove2 = (e: MouseEvent) => {
      if (dragging && dragStart.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        // menubar 30, dock area ~96
        const desktopH = window.innerHeight - 30 - 96;
        const nx = Math.max(
          8,
          Math.min(window.innerWidth - win.width - 8, dragStart.current.wx + dx),
        );
        const ny = Math.max(30, Math.min(30 + desktopH - 40, dragStart.current.wy + dy));
        onMove(win.id, nx, ny);
      }
      if (resizing && resizeStart.current) {
        const dw = e.clientX - resizeStart.current.x;
        const dh = e.clientY - resizeStart.current.y;
        const nw = Math.max(
          480,
          Math.min(window.innerWidth - win.x - 8, resizeStart.current.w + dw),
        );
        const nh = Math.max(
          360,
          Math.min(window.innerHeight - win.y - 84, resizeStart.current.h + dh),
        );
        onResize(win.id, nw, nh);
      }
    };
    const up = () => {
      setDragging(false);
      setResizing(false);
    };
    window.addEventListener('mousemove', onMove2);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', onMove2);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, resizing, win.id, win.x, win.y, win.width, win.height, onMove, onResize]);

  const doClose = () => {
    setClosing(true);
    setTimeout(() => onClose(win.id), 200);
  };
  const doMinimize = () => {
    setMinimizing(true);
    setTimeout(() => onMinimize(win.id), 260);
  };

  // Open-from-dock origin. Fall back to roughly centre-bottom.
  const dockBound = dockBounds[win.app];
  const dockX = dockBound?.x ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 0);
  const dockY = dockBound?.y ?? (typeof window !== 'undefined' ? window.innerHeight - 30 : 0);

  const style: CSSProperties = {
    left: win.x,
    top: win.y,
    width: win.width,
    height: win.height,
    zIndex: win.zIndex,
    // CSS custom props for the animation transforms.
    ['--origin-x' as keyof CSSProperties]: `${((dockX - win.x) / win.width) * 100}%`,
    ['--target-x' as keyof CSSProperties]: `${dockX - win.x - win.width / 2}px`,
    ['--target-y' as keyof CSSProperties]: `${dockY - win.y - win.height / 2}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={[
        'window',
        isActive ? 'active' : 'inactive',
        closing ? 'closing' : '',
        minimizing ? 'minimizing' : '',
        opening ? 'opening' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onMouseDown={onFocus}
    >
      <div
        className="titlebar"
        onMouseDown={onTitleMouseDown}
        onDoubleClick={() => onMaximize(win.id)}
      >
        <div className="traffic">
          <div className="tl r" onClick={doClose}>
            <Icon name="close" size={8} stroke={2.4} />
          </div>
          <div className="tl y" onClick={doMinimize}>
            <Icon name="minus" size={8} stroke={2.4} />
          </div>
          <div className="tl g" onClick={() => onMaximize(win.id)}>
            <Icon name={win.isMaximized ? 'restore' : 'expand'} size={8} stroke={2.4} />
          </div>
        </div>
        <div className="title">{win.title}</div>
        <div className="actions" />
      </div>
      <div className="window-body">{children}</div>
      {!win.isMaximized && <div className="resize-handle" onMouseDown={onResizeMouseDown} />}
    </div>
  );
}
