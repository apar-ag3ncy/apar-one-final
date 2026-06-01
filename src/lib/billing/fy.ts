/**
 * Indian financial-year helpers. FY runs April 1 → March 31.
 *
 * Sync, dep-free. Lives outside `lib/server/billing/` so it can be
 * imported from server actions ('use server' modules can only export
 * async functions — see NEXT-SESSION.md trap #1).
 *
 * The FY start month is configurable in `billing_settings.fy_start_month`
 * for multi-tenant generality later, but every helper here takes the
 * start month as an argument rather than reading it from the DB —
 * callers pre-load it once per request.
 */

/**
 * Return the start-of-FY date (April 1 by default) for the given
 * `dateIso` (YYYY-MM-DD). The returned date is always YYYY-04-01 for
 * the default fyStartMonth = 4.
 */
export function fyStartForDate(dateIso: string, fyStartMonth = 4): string {
  // dateIso is treated as a calendar date in IST — no timezone math.
  const [yStr, mStr] = dateIso.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    throw new Error(`fyStartForDate: invalid dateIso "${dateIso}"`);
  }
  const fyYear = m >= fyStartMonth ? y : y - 1;
  const mm = String(fyStartMonth).padStart(2, '0');
  return `${fyYear}-${mm}-01`;
}

/**
 * Compact FY label like "2025-26" for use in document numbers.
 */
export function fyLabelForDate(dateIso: string, fyStartMonth = 4): string {
  const start = fyStartForDate(dateIso, fyStartMonth);
  const yy = Number(start.slice(0, 4));
  const nextYy = (yy + 1) % 100;
  return `${yy}-${String(nextYy).padStart(2, '0')}`;
}

/**
 * Today's date in IST as YYYY-MM-DD. Use this anywhere we need a
 * "current calendar day" without a user-supplied date. IST is UTC+5:30.
 */
export function todayIstIso(now: Date = new Date()): string {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

/**
 * Format a document number from prefix / FY label / sequence + a format
 * mask. Supports `{prefix}`, `{fy}`, `{seq:NN}` (pads sequence to NN digits).
 *
 * Default mask is '{prefix}/{fy}/{seq:04}' → 'INV/2025-26/0001'.
 */
export function formatDocumentNumber(
  prefix: string,
  fyLabel: string,
  seq: number,
  mask = '{prefix}/{fy}/{seq:04}',
): string {
  return mask
    .replace('{prefix}', prefix)
    .replace('{fy}', fyLabel)
    .replace(/\{seq:(\d+)\}/, (_, n) => String(seq).padStart(Number(n), '0'));
}

/**
 * Inverse of formatDocumentNumber for the default mask — extract the
 * numeric sequence from a fully-formed document number. Returns NaN if
 * the input doesn't conform.
 */
export function parseSequence(documentNumber: string, mask = '{prefix}/{fy}/{seq:04}'): number {
  // Build a regex from the mask: {prefix}/{fy}/{seq:N} → (.+)/(.+)/(\d+)
  const pattern = mask
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex meta
    .replace('\\{prefix\\}', '(.+)')
    .replace('\\{fy\\}', '(.+)')
    .replace(/\\\{seq:(\d+)\\\}/, '(\\d+)');
  const m = new RegExp(`^${pattern}$`).exec(documentNumber);
  return m && m[3] ? Number(m[3]) : NaN;
}
