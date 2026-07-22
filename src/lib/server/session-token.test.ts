import { describe, it, expect } from 'vitest';

import { signToken, splitToken, tokenMatches } from '@/lib/server/session-token';

const SECRET = 'test-secret-value';
const ID = '11111111-1111-4111-8111-111111111111';
const HASH_A = 'scrypt$aaaa$1111';
const HASH_B = 'scrypt$bbbb$2222';

describe('session-token', () => {
  it('a freshly signed token verifies against the same secret + bindTo', () => {
    const token = signToken(SECRET, ID, HASH_A);
    const parts = splitToken(token);
    expect(parts?.id).toBe(ID);
    expect(tokenMatches(SECRET, ID, HASH_A, parts!.mac)).toBe(true);
  });

  it('token is INVALID once bindTo changes (password change/reset revokes it)', () => {
    const token = signToken(SECRET, ID, HASH_A);
    const parts = splitToken(token)!;
    // Same id + secret, but the stored hash rotated → old token no longer valid.
    expect(tokenMatches(SECRET, ID, HASH_B, parts.mac)).toBe(false);
  });

  it('token is INVALID under a different secret (no cross-secret forgery)', () => {
    const token = signToken(SECRET, ID, HASH_A);
    const parts = splitToken(token)!;
    expect(tokenMatches('other-secret', ID, HASH_A, parts.mac)).toBe(false);
  });

  it('token is INVALID for a different id', () => {
    const token = signToken(SECRET, ID, HASH_A);
    const parts = splitToken(token)!;
    expect(tokenMatches(SECRET, 'other-id', HASH_A, parts.mac)).toBe(false);
  });

  it('splitToken rejects missing / malformed tokens', () => {
    expect(splitToken(undefined)).toBeNull();
    expect(splitToken('')).toBeNull();
    expect(splitToken('nodot')).toBeNull();
    expect(splitToken('.leadingdot')).toBeNull();
    expect(splitToken('trailingdot.')).toBeNull();
  });

  it('tokenMatches returns false for a non-hex / garbage mac instead of throwing', () => {
    expect(tokenMatches(SECRET, ID, HASH_A, 'not-hex!!')).toBe(false);
    expect(tokenMatches(SECRET, ID, HASH_A, '')).toBe(false);
  });

  it('the mac is a stable function of (secret, id, bindTo)', () => {
    expect(signToken(SECRET, ID, HASH_A)).toBe(signToken(SECRET, ID, HASH_A));
    expect(signToken(SECRET, ID, HASH_A)).not.toBe(signToken(SECRET, ID, HASH_B));
  });
});
