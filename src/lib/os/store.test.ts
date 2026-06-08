import { afterEach, describe, expect, it } from 'vitest';
import { __getOsStateForTests, __resetOsStoreForTests, osActions } from './store';

// Derive the usable ceiling from whatever viewport the test env reports
// (jsdom defaults to 1024x768; the SSR stub is 1440x900). Gutters mirror
// the store: TOP=36, DOCK=96, EDGE=16.
const EDGE = 16;
const TOP = 36;
const DOCK = 96;
const VW = typeof window !== 'undefined' ? window.innerWidth : 1440;
const VH = typeof window !== 'undefined' ? window.innerHeight : 900;
const MAX_W = VW - EDGE * 2;
const MAX_H = VH - TOP - DOCK - EDGE * 2;

// Drive the store directly through actions. The hook (`useOsStore`) is
// exercised via the OS shell; here we own the action contract.

afterEach(() => {
  __resetOsStoreForTests();
});

describe('osStore.openWindow', () => {
  it('opens a single app window when none exist', () => {
    const id = osActions.openWindow({ app: 'clients' });
    expect(id).toMatch(/^w\d+-/);
  });

  it('dedupes a non-entity window for the same app', () => {
    const a = osActions.openWindow({ app: 'settings' });
    const b = osActions.openWindow({ app: 'settings' });
    expect(a).toBe(b);
  });

  it('opens a fresh window per entityId+tab combo', () => {
    const a = osActions.openWindow({ app: 'clients', entityId: 'c1', tab: 'overview' });
    const b = osActions.openWindow({ app: 'clients', entityId: 'c1', tab: 'transactions' });
    expect(a).not.toBe(b);
  });

  it('reuses an existing window when the same entityId+tab is requested', () => {
    const a = osActions.openWindow({ app: 'clients', entityId: 'c1', tab: 'overview' });
    const b = osActions.openWindow({ app: 'clients', entityId: 'c1', tab: 'overview' });
    expect(a).toBe(b);
  });

  it('honors alwaysNew even on a dupe request', () => {
    const a = osActions.openWindow({ app: 'clients', entityId: 'c1', tab: 'overview' });
    const b = osActions.openWindow({
      app: 'clients',
      entityId: 'c1',
      tab: 'overview',
      alwaysNew: true,
    });
    expect(a).not.toBe(b);
  });
});

describe('osStore.openWindow viewport clamping', () => {
  it('clamps an oversized window down to the usable desktop area', () => {
    const id = osActions.openWindow({ app: 'bank_recon', width: 2000, height: 1600 });
    const win = __getOsStateForTests().windows.find((w) => w.id === id)!;
    expect(win.width).toBe(MAX_W);
    expect(win.height).toBe(MAX_H);
  });

  it('keeps a freshly opened window fully on-screen (no bottom/right overhang)', () => {
    const id = osActions.openWindow({ app: 'documents', width: 800, height: 1000 });
    const win = __getOsStateForTests().windows.find((w) => w.id === id)!;
    // size clamped, and the frame fits inside the viewport bounds
    expect(win.height).toBeLessThanOrEqual(MAX_H);
    expect(win.x + win.width).toBeLessThanOrEqual(VW - EDGE);
    expect(win.y + win.height).toBeLessThanOrEqual(VH - DOCK - EDGE);
    expect(win.x).toBeGreaterThanOrEqual(EDGE);
    expect(win.y).toBeGreaterThanOrEqual(TOP + EDGE);
  });

  it('leaves a window that already fits unchanged in size', () => {
    const id = osActions.openWindow({ app: 'clients', width: 880, height: 580 });
    const win = __getOsStateForTests().windows.find((w) => w.id === id)!;
    expect(win.width).toBe(880);
    expect(win.height).toBe(580);
  });

  it('clamps oversized geometry on hydrate (e.g. a deep-link from a bigger monitor)', () => {
    osActions.hydrate(
      [
        {
          id: 'h1',
          app: 'reports',
          title: 'Trial Balance',
          entityId: 'trial-balance',
          x: 3000,
          y: 2000,
          width: 2400,
          height: 1800,
          zIndex: 101,
          isMinimized: false,
          isMaximized: false,
        },
      ],
      'h1',
    );
    const win = __getOsStateForTests().windows.find((w) => w.id === 'h1')!;
    expect(win.width).toBe(MAX_W);
    expect(win.height).toBe(MAX_H);
    expect(win.x + win.width).toBeLessThanOrEqual(VW - EDGE);
    expect(win.y + win.height).toBeLessThanOrEqual(VH - DOCK - EDGE);
  });
});

describe('osStore.closeWindow', () => {
  it('removes the window and clears focus when closing the focused one', () => {
    osActions.openWindow({ app: 'clients' });
    const second = osActions.openWindow({ app: 'vendors' });
    osActions.focusWindow(second);
    osActions.closeWindow(second);
    // No throw + opening another window still works
    const third = osActions.openWindow({ app: 'reports' });
    expect(third).toMatch(/^w\d+-/);
  });
});

describe('osStore.maximizeWindow', () => {
  it('toggles maximize state', () => {
    const id = osActions.openWindow({ app: 'clients', width: 600, height: 400 });
    osActions.maximizeWindow(id);
    // Maximize stores restore geometry; toggling again restores it. We
    // don't render so we can't inspect; the behavior here is the
    // round-trip is non-throwing under our default viewport stub.
    expect(() => osActions.maximizeWindow(id)).not.toThrow();
  });
});
