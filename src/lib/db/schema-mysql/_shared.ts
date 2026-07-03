import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { char, datetime } from 'drizzle-orm/mysql-core';

/**
 * MariaDB equivalents of the Postgres `_shared` helpers (see
 * ../schema/_shared.ts). Standard columns on every business table.
 *
 * - Postgres `uuid` + `gen_random_uuid()` has no MariaDB type; we use
 *   `char(36)` and generate the id in the app (`randomUUID()`), which keeps
 *   the existing string UUIDs stable when the data is copied over.
 * - Postgres `timestamptz` -> `datetime(3)`; MariaDB has no timezone-aware
 *   type, so every instant is stored as UTC by convention (the app already
 *   works in UTC `Date`s). DATETIME (not TIMESTAMP) avoids the 2038 range cap.
 */
export const timestamps = () => ({
  id: char({ length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  createdAt: datetime({ mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime({ mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
  deletedAt: datetime({ mode: 'date', fsp: 3 }),
});

/** created_by / updated_by — FK to `users.id` (char(36)). */
export const auditColumns = () => ({
  createdBy: char({ length: 36 }),
  updatedBy: char({ length: 36 }),
});
