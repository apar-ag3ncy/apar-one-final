// Client-safe list of the fonts an invoice format can use. react-pdf can only
// lay out its three built-in families on the server, so the editor's dropdown
// is limited to these. Kept out of the 'use server' invoice-themes module
// (which may only export async functions).
export const INVOICE_FONTS = ['Helvetica', 'Times-Roman', 'Courier'] as const;
export type InvoiceFont = (typeof INVOICE_FONTS)[number];
