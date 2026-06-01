// TODO(backend): replace this module's exports with imports from `@/lib/money` once Backend
// ships the canonical helpers. This frontend-local copy exists so DataTable, charts, and
// CurrencyInput can render real money before the backend module lands.

const COMPACT_FORMATTER = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
});

const PAISE_PER_RUPEE = 100n;

function paiseToRupeeString(paise: bigint, fractionDigits: 0 | 2): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const wholeRupees = abs / PAISE_PER_RUPEE;
  const paiseRemainder = abs % PAISE_PER_RUPEE;
  const formattedWhole = COMPACT_FORMATTER.format(wholeRupees);
  if (fractionDigits === 0) {
    return negative ? `-${formattedWhole}` : formattedWhole;
  }
  const paddedFraction = paiseRemainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}${formattedWhole}.${paddedFraction}`;
}

export function formatINR(paise: bigint, opts: { showFraction?: boolean } = {}): string {
  const showFraction = opts.showFraction ?? true;
  const body = paiseToRupeeString(paise, showFraction ? 2 : 0);
  // Replace plain "-" with explicit minus + ₹ prefix via Intl-style spacing.
  if (body.startsWith('-')) {
    return `-₹${body.slice(1)}`;
  }
  return `₹${body}`;
}

const ONE_LAKH = 1_00_000n; // 1L unit = 100,000 rupees
const TEN_LAKH_BOUNDARY = 10_00_000n; // start using "L" once value ≥ ₹10 lakh
const ONE_CRORE = 1_00_00_000n; // 1Cr unit = 10,000,000 rupees

/**
 * Compact INR for axis labels: ₹1Cr, ₹25.5L, ₹3.25Cr. Values below ₹10 lakh render with
 * Indian grouping but no fraction (e.g. ₹99,999).
 */
export function formatINRCompact(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const sign = negative ? '-' : '';
  const rupees = abs / PAISE_PER_RUPEE;
  if (rupees >= ONE_CRORE) {
    const cr = Number(rupees) / Number(ONE_CRORE);
    return `${sign}₹${trimTrailingZero(cr.toFixed(2))}Cr`;
  }
  if (rupees >= TEN_LAKH_BOUNDARY) {
    const lakh = Number(rupees) / Number(ONE_LAKH);
    return `${sign}₹${trimTrailingZero(lakh.toFixed(2))}L`;
  }
  if (rupees === 0n) {
    return '₹0';
  }
  return `${sign}₹${COMPACT_FORMATTER.format(rupees)}`;
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.?0+$/, '');
}

/**
 * Parse a human-typed rupee string (with or without Indian grouping, optional decimals)
 * into a bigint paise value. Returns null for empty / unparseable input.
 *
 * Examples: "1,23,456.78" → 12345678n, "1500" → 150000n, "₹ 1.5L" → null (compact suffixes
 * are not accepted in input; only display).
 */
export function parseRupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim().replace(/^₹\s?/, '').replace(/,/g, '');
  if (trimmed === '' || trimmed === '-' || trimmed === '.') return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = body.split('.');
  const wholeBig = BigInt(whole);
  const paddedFraction = (fraction + '00').slice(0, 2);
  const fractionBig = BigInt(paddedFraction);
  const paise = wholeBig * PAISE_PER_RUPEE + fractionBig;
  return negative ? -paise : paise;
}

/**
 * Format paise for an input field — Indian grouping with up to 2 decimal places, no ₹ prefix.
 * Returns "" for null/undefined so it can drive a controlled input.
 */
export function formatPaiseForInput(paise: bigint | null | undefined): string {
  if (paise === null || paise === undefined) return '';
  return paiseToRupeeString(paise, 2);
}
