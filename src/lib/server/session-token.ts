import 'server-only';

// Signed session-cookie helpers, extracted so they're pure + unit-testable
// (a 'use server' module can only export async actions). A token is
// `${id}.${mac}` where `mac = HMAC-SHA256(secret, `${id}.${bindTo}`)`.
//
// `bindTo` binds the token to a rotating server-side value — for the employee
// session it's the current `password_hash`. Because the MAC covers it, changing
// that value (password change / reset / revoke) invalidates every previously
// issued token without any server-side session table: verification recomputes
// the MAC against the CURRENT value and fails for stale tokens.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Produce a signed token binding `id` to `bindTo` under `secret`. */
export function signToken(secret: string, id: string, bindTo: string): string {
  const mac = createHmac('sha256', secret).update(`${id}.${bindTo}`).digest('hex');
  return `${id}.${mac}`;
}

/**
 * Split a token into `{ id, mac }` WITHOUT verifying — the id is only a lookup
 * key so the caller can fetch the current `bindTo`; `tokenMatches` is the real
 * gate. Returns null for a missing/malformed token.
 */
export function splitToken(token: string | undefined): { id: string; mac: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return null;
  return { id: token.slice(0, dot), mac: token.slice(dot + 1) };
}

/** Constant-time check that `mac` is a valid signature for `(id, bindTo)`. */
export function tokenMatches(secret: string, id: string, bindTo: string, mac: string): boolean {
  const expected = createHmac('sha256', secret).update(`${id}.${bindTo}`).digest('hex');
  try {
    const a = Buffer.from(mac, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
