/**
 * Indian GST state codes ↔ names. The 2-digit code is the canonical GST
 * "state code" (first two digits of a GSTIN, and the value stored in
 * `invoices.place_of_supply`). The UI shows the full state NAME and stores the
 * code — so users pick a state, never a raw number.
 *
 * Codes mirror the set used by `stateFromGstin` in entities/clients.ts +
 * vendors.ts. International / non-India supply is out of scope for now.
 */
export type GstState = { code: string; name: string };

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

/** States sorted by name — for dropdowns. */
export const GST_STATES_BY_NAME: readonly GstState[] = [...GST_STATES].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const CODE_TO_NAME = new Map(GST_STATES.map((s) => [s.code, s.name]));

export function stateNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return CODE_TO_NAME.get(code) ?? null;
}

export function isValidStateCode(code: string | null | undefined): boolean {
  return !!code && CODE_TO_NAME.has(code);
}
