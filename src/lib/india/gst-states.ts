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
const ALPHA_TO_CODE = new Map([
  ['JK', '01'],
  ['HP', '02'],
  ['PB', '03'],
  ['CH', '04'],
  ['UK', '05'],
  ['HR', '06'],
  ['DL', '07'],
  ['RJ', '08'],
  ['UP', '09'],
  ['BR', '10'],
  ['SK', '11'],
  ['AR', '12'],
  ['NL', '13'],
  ['MN', '14'],
  ['MZ', '15'],
  ['TR', '16'],
  ['ML', '17'],
  ['AS', '18'],
  ['WB', '19'],
  ['JH', '20'],
  ['OD', '21'],
  ['CG', '22'],
  ['MP', '23'],
  ['GJ', '24'],
  ['DN', '26'],
  ['DD', '26'],
  ['MH', '27'],
  ['KA', '29'],
  ['GA', '30'],
  ['LD', '31'],
  ['KL', '32'],
  ['TN', '33'],
  ['PY', '34'],
  ['AN', '35'],
  ['TS', '36'],
  ['TG', '36'],
  ['AP', '37'],
  ['LA', '38'],
]);

export function stateNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = stateCodeToGstCode(code);
  return normalized ? (CODE_TO_NAME.get(normalized) ?? null) : null;
}

export function isValidStateCode(code: string | null | undefined): boolean {
  return !!stateCodeToGstCode(code);
}

export function stateCodeToGstCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  if (CODE_TO_NAME.has(trimmed)) return trimmed;
  return ALPHA_TO_CODE.get(trimmed) ?? null;
}
