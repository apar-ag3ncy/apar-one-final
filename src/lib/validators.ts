/**
 * Format validators for India-specific identifiers. CLAUDE rules #20–#23.
 *
 *   - GSTIN: 15 chars, deterministic structure
 *   - PAN: 10 chars
 *   - HSN/SAC: 4–8 digits
 *   - IFSC: 11 chars (4 alpha + 0 + 6 alphanumeric)
 *   - TDS section: enum in `TDS_SECTIONS`
 *
 * Captured-as-entered (CLAUDE rule #2). No computation derived from these.
 */

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const HSN_RE = /^[0-9]{4,8}$/;
export const AADHAAR_MASKED_RE = /^X{8}[0-9]{4}$/; // 'XXXXXXXX1234'
export const PAN_MASKED_RE = /^X{5}[0-9]{4}X$/; // 'XXXXX1234X'

/**
 * TDS sections that Apār captures. The brief lists 192/194C/194J/194I
 * (building + plant)/194H/194Q as the v1 seed; 194O is included per
 * CLAUDE rule #23 (e-commerce).
 *
 * Use as the closed enum that `postings.metadata.tds_section` is
 * validated against.
 */
export const TDS_SECTIONS = [
  '192', // salary
  '194C', // contractor
  '194H', // commission/brokerage
  '194I_building', // rent on land/building
  '194I_plant', // rent on plant/machinery
  '194J', // professional/technical
  '194O', // e-commerce
  '194Q', // large vendor purchases
  'none', // captured "no TDS" answer
] as const;

export type TdsSection = (typeof TDS_SECTIONS)[number];

export function isValidGSTIN(v: string): boolean {
  return GSTIN_RE.test(v);
}

export function isValidPAN(v: string): boolean {
  return PAN_RE.test(v);
}

export function isValidIFSC(v: string): boolean {
  return IFSC_RE.test(v);
}

export function isValidHSN(v: string): boolean {
  return HSN_RE.test(v);
}

export function isValidTdsSection(v: string): v is TdsSection {
  return (TDS_SECTIONS as readonly string[]).includes(v);
}

/** "ABCDE1234F" → "XXXXX1234X" — per CLAUDE rule #28. */
export function maskPAN(pan: string): string {
  if (!isValidPAN(pan)) {
    throw new Error(`maskPAN: invalid PAN "${pan}"`);
  }
  return `XXXXX${pan.slice(5, 9)}X`;
}

/** "123412341234" → "XXXXXXXX1234" — per CLAUDE rule #28. */
export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar.replace(/\s+/g, '');
  if (!/^[0-9]{12}$/.test(digits)) {
    throw new Error(`maskAadhaar: invalid Aadhaar`);
  }
  return `XXXXXXXX${digits.slice(8, 12)}`;
}

/** "123456789012" → "9012". For `entity_bank_accounts.account_last4`. */
export function last4(accountNumber: string): string {
  const digits = accountNumber.replace(/\s+/g, '');
  if (digits.length < 4) {
    throw new Error('last4: account number must be at least 4 digits');
  }
  return digits.slice(-4);
}
