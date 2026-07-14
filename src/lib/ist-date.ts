/**
 * Business-timezone date helpers. Apār operates in Asia/Kolkata (IST); the
 * attendance store keys rows by plain YYYY-MM-DD dates, so "today" must be
 * computed in IST everywhere — client machines and Vercel's UTC servers
 * alike. `new Date().toISOString().slice(0, 10)` is the classic bug: it
 * yields the UTC date, which is *yesterday* in IST between 00:00 and 05:29.
 *
 * Plain sync module (no 'use server') so both client components and server
 * actions can import it.
 */

const IST_TIME_ZONE = 'Asia/Kolkata';

/** Today's date in Asia/Kolkata as YYYY-MM-DD ('en-CA' formats ISO-style). */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TIME_ZONE });
}

/**
 * The YYYY-MM-DD that is `n` days before today in Asia/Kolkata.
 * Arithmetic happens in UTC on the already-resolved IST date, so no DST /
 * offset drift is possible (IST has no DST anyway).
 */
export function istDaysAgo(n: number): string {
  const base = new Date(`${todayIST()}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString().slice(0, 10);
}
