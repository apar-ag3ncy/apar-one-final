import { describe, expect, it } from 'vitest';
import { decodeSlot, encodeSlot } from './per-window-nuqs';

describe('encodeSlot', () => {
  it('emits just the app id for an empty entity/tab', () => {
    expect(encodeSlot({ app: 'inbox' })).toBe('inbox');
  });
  it('emits app:entity for entity-scoped windows without a tab', () => {
    expect(encodeSlot({ app: 'clients', entityId: 'c1' })).toBe('clients:c1');
  });
  it('emits app::tab when tab is set but entity is not', () => {
    expect(encodeSlot({ app: 'settings', tab: 'roles' })).toBe('settings::roles');
  });
  it('emits app:entity:tab when everything is set', () => {
    expect(encodeSlot({ app: 'vendors', entityId: 'v2', tab: 'documents' })).toBe(
      'vendors:v2:documents',
    );
  });
});

describe('decodeSlot', () => {
  it('round-trips with encodeSlot', () => {
    for (const slot of [
      { app: 'inbox' as const },
      { app: 'clients' as const, entityId: 'c1' },
      { app: 'settings' as const, tab: 'roles' },
      { app: 'vendors' as const, entityId: 'v2', tab: 'documents' },
    ]) {
      const out = decodeSlot(encodeSlot(slot));
      expect(out).toEqual({
        app: slot.app,
        entityId: 'entityId' in slot ? slot.entityId : undefined,
        tab: 'tab' in slot ? slot.tab : undefined,
      });
    }
  });
  it('rejects unknown apps', () => {
    expect(decodeSlot('garbage')).toBeNull();
    expect(decodeSlot('badapp:x')).toBeNull();
  });
  it('rejects empty input', () => {
    expect(decodeSlot('')).toBeNull();
  });
});
