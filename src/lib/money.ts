/**
 * Money in Apar One.
 *
 * **CLAUDE.md rule #1**: money is `bigint` paise in the DB, `Paise = bigint`
 * in code, formatted with `Intl.NumberFormat('en-IN', { currency: 'INR' })`.
 * Never `number`. The DB schema check (`scripts/check-no-floats.ts`) and
 * `assertBigint()` here are the two enforcement points.
 *
 * **LEDGER-SPEC §0.4** + the agent brief: stay with hand-rolled bigint paise.
 * `dinero.js` is intentionally not a dependency.
 */

export type Paise = bigint;

const PAISE_PER_RUPEE = 100n;

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const INR_COMPACT_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 2,
});

/**
 * Runtime guard. Throws if a value snuck in as `number`. Use at any
 * server-action / service boundary that receives money from the wire.
 */
export function assertBigint(value: unknown, label = 'money'): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new TypeError(`${label} must be bigint paise, got ${typeof value}: ${String(value)}`);
  }
}

/**
 * Rupee decimal → paise. Accepts string OR number at input boundaries
 * (form fields). Validates two-decimal precision. Always returns bigint.
 */
export function rupeesToPaise(rupees: string | number): Paise {
  const raw = typeof rupees === 'number' ? rupees.toString() : rupees.trim();
  if (raw === '' || raw === '-' || raw === '+') {
    throw new TypeError(`rupeesToPaise: empty input`);
  }
  // Single optional sign + 1+ digits + optional .[0-2] digits.
  const match = /^[+-]?\d+(\.\d{1,2})?$/.exec(raw);
  if (!match) {
    throw new TypeError(`rupeesToPaise: "${raw}" is not a valid INR amount (max 2 decimals)`);
  }
  const negative = raw.startsWith('-');
  const stripped = raw.replace(/^[+-]/, '');
  const [whole = '0', frac = ''] = stripped.split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  const paise = BigInt(whole) * PAISE_PER_RUPEE + BigInt(paddedFrac);
  return negative ? -paise : paise;
}

/**
 * Paise → rupee decimal string. Lossless. For form `defaultValue` or
 * non-currency display.
 */
export function paiseToRupees(paise: Paise): string {
  assertBigint(paise, 'paise');
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / PAISE_PER_RUPEE;
  const frac = abs % PAISE_PER_RUPEE;
  const fracStr = frac.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`;
}

/**
 * Format paise as INR currency for display. Full grouping (`₹ 1,23,456.00`).
 */
export function formatINR(paise: Paise): string {
  assertBigint(paise, 'paise');
  // Intl wants Number for value; we lose precision past 2^53 paise (~₹90 trillion).
  // For display this is fine — agency P&L doesn't approach that.
  return INR_FORMATTER.format(Number(paise) / 100);
}

/**
 * Compact format for chart axes (`₹1L`, `₹25L`, `₹1Cr`). CLAUDE rule #16.
 */
export function formatINRCompact(paise: Paise): string {
  assertBigint(paise, 'paise');
  return INR_COMPACT_FORMATTER.format(Number(paise) / 100);
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(x: number): string {
  if (x < 20) return ONES[x]!;
  return TENS[Math.floor(x / 10)]! + (x % 10 ? ' ' + ONES[x % 10]! : '');
}
function threeDigitWords(x: number): string {
  const h = Math.floor(x / 100);
  const r = x % 100;
  let s = '';
  if (h) s += ONES[h]! + ' Hundred';
  if (r) s += (s ? ' ' : '') + twoDigitWords(r);
  return s;
}
/** Whole number → Indian-system English words (Crore/Lakh/Thousand/Hundred). */
function indianNumberWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  let rem = n;
  const crore = rem / 10000000n;
  rem %= 10000000n;
  if (crore > 0n) {
    parts.push((crore > 99n ? indianNumberWords(crore) : twoDigitWords(Number(crore))) + ' Crore');
  }
  const lakh = rem / 100000n;
  rem %= 100000n;
  if (lakh > 0n) parts.push(twoDigitWords(Number(lakh)) + ' Lakh');
  const thousand = rem / 1000n;
  rem %= 1000n;
  if (thousand > 0n) parts.push(twoDigitWords(Number(thousand)) + ' Thousand');
  const hundreds = Number(rem);
  if (hundreds > 0) parts.push(threeDigitWords(hundreds));
  return parts.join(' ');
}

/**
 * Amount in words for invoices, e.g. ₹4,72,000 → "Rupees Four Lakh Seventy Two
 * Thousand Only". Indian numbering; appends "and N Paise" when there's a
 * sub-rupee remainder.
 */
export function rupeesInWordsINR(paise: Paise): string {
  assertBigint(paise, 'paise');
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const remPaise = Number(abs % 100n);
  let out = `Rupees ${indianNumberWords(rupees)}`;
  if (remPaise > 0) out += ` and ${twoDigitWords(remPaise)} Paise`;
  out += ' Only';
  return negative ? `Minus ${out}` : out;
}

const INR_PLAIN_FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Indian-grouped amount WITHOUT a currency symbol, e.g. ₹4,72,000 →
 * "4,72,000.00". For the invoice PDF, where the column is already labelled
 * "Amount in Rupees" and the built-in PDF font (Helvetica) has no ₹ glyph.
 */
export function formatRupeesPlain(paise: Paise): string {
  assertBigint(paise, 'paise');
  return INR_PLAIN_FORMATTER.format(Number(paise) / 100);
}

/** Sum a list of paise values. Returns 0n for empty input. */
export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0n;
  for (const v of values) {
    assertBigint(v, 'paise');
    total += v;
  }
  return total;
}

/** True when |a - b| ≤ tolerance (default 0n). For validation checks only. */
export function paiseEqual(a: Paise, b: Paise, tolerance: Paise = 0n): boolean {
  assertBigint(a, 'a');
  assertBigint(b, 'b');
  assertBigint(tolerance, 'tolerance');
  const diff = a > b ? a - b : b - a;
  return diff <= tolerance;
}
