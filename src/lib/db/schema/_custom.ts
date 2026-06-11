import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `bytea` column. Drizzle has no first-class bytea helper, so we
 * define a custom type. postgres-js decodes bytea to a Node `Buffer` (which
 * extends `Uint8Array`), and accepts a `Buffer`/`Uint8Array` on insert.
 *
 * Used by `company_documents.data` to keep uploaded files inside Postgres —
 * the app runs against vanilla local Postgres with no Supabase Storage, so
 * the vault/signed-URL path is unavailable. Company-owned documents (GST
 * certificate, partnership deed, rent agreements, …) are not third-party KYC;
 * they are meant to be downloaded/viewed/copied, so storing the bytes inline
 * is both simpler and portable across every environment.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
