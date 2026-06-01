import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export { auditColumns } from './_shared';

// LEDGER-SPEC §8.5 and SPEC-AMENDMENT-001 §2.3 forbid any delete (soft or
// hard) on ledger tables (transactions, postings, periods). RLS blocks
// DELETE; this mixin omits `deletedAt` so soft-delete can't sneak in via
// the schema. Reversal happens via reversing entries, never `deletedAt`.
export const timestamps = () => ({
  id: uuid()
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
