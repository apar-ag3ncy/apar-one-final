/**
 * CGST Act §34(2) — credit note GST-impact window.
 *
 * A credit note may reverse the output-GST liability of the original
 * invoice only if it is issued before the EARLIER of:
 *
 *   (a) 30 November of the financial year FOLLOWING the original
 *       invoice's FY, OR
 *   (b) The date on which GSTR-9 (annual return) is filed for the
 *       original invoice's FY.
 *
 * v1 only models (a) — GSTR-9 filing dates aren't tracked in the system
 * yet. When they are (per `billing_settings` extension or a new
 * `gst_filings` table), update this helper to also compare against the
 * stored date.
 *
 * Returns true if a credit note dated `creditNoteDateIso` may still
 * reverse GST output liability for an invoice whose FY started on
 * `originalInvoiceFyStartIso`.
 */
export function isGstImpactAllowed(
  creditNoteDateIso: string,
  originalInvoiceFyStartIso: string,
): boolean {
  // FY start is YYYY-04-01 in the v1 calendar; next-FY Nov 30 cutoff is
  // (startYear + 1)-11-30.
  const startYear = Number(originalInvoiceFyStartIso.slice(0, 4));
  if (!Number.isFinite(startYear)) {
    throw new Error(`isGstImpactAllowed: invalid fyStart "${originalInvoiceFyStartIso}"`);
  }
  const cutoffIso = `${startYear + 1}-11-30`;
  return creditNoteDateIso <= cutoffIso;
}
