// Client-safe list of the fonts an invoice format can use — the three react-pdf
// built-ins plus the four embedded faces registered in
// `server/billing/pdf/fonts` (Rubik/Inter/Lato/Open Sans). Kept out of the
// 'use server' invoice-themes module (which may only export async functions).
export const INVOICE_FONTS = [
  'Helvetica',
  'Times-Roman',
  'Courier',
  'Rubik',
  'Inter',
  'Lato',
] as const;
export type InvoiceFont = (typeof INVOICE_FONTS)[number];
