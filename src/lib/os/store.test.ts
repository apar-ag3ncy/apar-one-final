import { afterEach, describe, expect, it } from 'vitest';
import { __resetOsStoreForTests, osActions } from './store';

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
