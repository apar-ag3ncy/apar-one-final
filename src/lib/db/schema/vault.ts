import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { auditColumns, timestamps } from './_shared';
import { bytea } from './_custom';

/**
 * Settings → Vault: the agency's account IDs + passwords, encrypted at rest.
 *
 * Crypto layout (see lib/server/settings/vault-crypto.ts):
 *   - a random 32-byte data-encryption key (DEK) encrypts every item;
 *   - the DEK is wrapped (AES-256-GCM) by a key derived via scrypt from the
 *     user-chosen vault password + `kdfSalt`;
 *   - a wrong password fails the GCM auth tag on `wrappedDek`, so the wrap
 *     doubles as the password verifier — no separate hash is stored;
 *   - changing the vault password only re-wraps the DEK.
 *
 * `vault_items.title` stays plaintext so the locked state can list entries;
 * username/password/url/notes live in the encrypted `data` blob
 * (iv ‖ tag ‖ ciphertext of a JSON payload).
 *
 * ⚠ Never attach the 0034 log_audit_diff() trigger (or any row-snapshotting
 * trigger) to these tables — it would archive old DEK wraps / ciphertext
 * into audit_log, defeating password rotation. App-level logAudit only.
 *
 * A partial unique index (vault_settings_singleton, migration 0042) enforces
 * at most one live settings row.
 */
export const vaultSettings = pgTable('vault_settings', {
  ...timestamps(),
  ...auditColumns(),
  kdfSalt: bytea().notNull(),
  /** scrypt params {N, r, p, keylen} — stored so they can be raised later;
   *  unlockVault re-wraps under current defaults when these are weaker. */
  kdfParams: jsonb().notNull().default({}),
  wrappedDek: bytea().notNull(),
  /** Brute-force lockout: consecutive wrong-password attempts + cooldown. */
  failedAttempts: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
});

export const vaultItems = pgTable(
  'vault_items',
  {
    ...timestamps(),
    ...auditColumns(),
    /** Plaintext — shown in the locked list. Keep secrets out of it. */
    title: text().notNull(),
    /** AES-256-GCM blob (iv ‖ tag ‖ ciphertext) of the credential JSON. */
    data: bytea().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [index().on(t.title)],
);

export type VaultSettingsRow = typeof vaultSettings.$inferSelect;
export type VaultItemRow = typeof vaultItems.$inferSelect;
