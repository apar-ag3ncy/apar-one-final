// Demo formatters — paise → ₹ string, name → initials.
//
// `formatINR` re-exports the canonical bigint-paise implementation from
// `components/shared/format-inr` so the OS demo and the Dashboard render
// money identically. Once Backend ships `@/lib/money` per BACKEND-AUDIT F1,
// both surfaces will switch to that import in one step.

export { formatINR, parseRupeesToPaise } from '@/components/shared/format-inr';

import type { Paise } from './types';

/**
 * Paise → unformatted decimal-rupee string suitable for an `<input type="number">`
 * value (no Indian grouping, two fraction digits).
 *
 * Example: `12_345_678n` → `"123456.78"`. Pair with `parseRupeesToPaise` on submit.
 *
 * Until B ships `<CurrencyInput>`, OS form modals use plain `<input type="number">`
 * with this helper for display + `parseRupeesToPaise` for parse. The
 * Indian-grouped display lives in `formatINR(paise)` for tables / KPIs only.
 */
export function paiseToDecimalRupees(paise: Paise): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = (abs / 100n).toString();
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0] ?? '')
    .join('')
    .toUpperCase();
}
