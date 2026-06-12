'use server';

import { asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { vaultItems, vaultSettings } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireCapability } from '@/lib/rbac';
import { getActorContext } from '@/lib/server/actor';

import {
  DEFAULT_KDF_PARAMS,
  decryptJson,
  deriveKek,
  encryptJson,
  newDek,
  newSalt,
  unwrapDek,
  wrapDek,
  type KdfParams,
} from './vault-crypto';

/**
 * Settings → Vault actions. Every read of secret material requires the vault
 * password on the call — the server never caches the derived key, so closing
 * the pane re-locks the vault by construction.
 *
 * All actions are gated by `manage_vault` ON TOP of the password: a caller
 * needs both the role capability and the vault password to see anything.
 *
 * Brute force: 8 consecutive wrong passwords lock the vault for 15 minutes
 * (checked BEFORE the expensive KDF). Every wrong-password attempt — on any
 * action, not just unlock — is audit-logged with the action name.
 *
 * Password change ROTATES the data-encryption key and re-encrypts every item,
 * so an old password + an old backup of vault_settings cannot decrypt
 * anything written after the change.
 *
 * Audit payloads NEVER contain secret values — events and titles only, and
 * the 0034 row-snapshot trigger must never be attached to the vault tables
 * (it would archive old DEK wraps).
 *
 * Returns the safe `{ ok } | { ok:false, message }` shapes so the client can
 * toast `message` directly.
 */

const WRONG_PASSWORD = 'Wrong vault password.';
/** Small fixed delay on failed unlocks to blunt brute-force loops. */
const FAIL_DELAY_MS = 400;
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

const PasswordSchema = z.string().min(8, 'Vault password must be at least 8 characters.').max(200);

const ItemInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  username: z.string().trim().max(500).default(''),
  password: z.string().max(500).default(''),
  url: z.string().trim().max(1000).default(''),
  notes: z.string().trim().max(4000).default(''),
});

export type VaultItemInput = z.input<typeof ItemInputSchema>;

/** The decrypted credential payload stored inside each item's blob. */
type ItemSecret = { username: string; password: string; url: string; notes: string };

export type VaultItem = ItemSecret & {
  id: string;
  title: string;
  updatedAt: string;
  /** Blob failed to decrypt (tampered/corrupted row). Only delete works. */
  corrupted?: boolean;
};

export type VaultStatusResult =
  | { ok: true; configured: boolean; itemCount: number }
  | { ok: false; denied: boolean; message: string };

export type VaultUnlockResult = { ok: true; items: VaultItem[] } | { ok: false; message: string };
export type VaultActionResult = { ok: true } | { ok: false; message: string };

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function requireVaultActor() {
  const ctx = await getActorContext();
  requireCapability(ctx, 'manage_vault');
  return ctx;
}

async function loadSettings() {
  const [row] = await db
    .select()
    .from(vaultSettings)
    .where(isNull(vaultSettings.deletedAt))
    // Deterministic even if duplicates ever exist (singleton index guards).
    .orderBy(asc(vaultSettings.createdAt))
    .limit(1);
  return row ?? null;
}

type SettingsRow = NonNullable<Awaited<ReturnType<typeof loadSettings>>>;

function storedParams(settings: SettingsRow): KdfParams {
  return { ...DEFAULT_KDF_PARAMS, ...(settings.kdfParams as Partial<KdfParams>) };
}

/**
 * The shared password gate: lockout check (before the expensive KDF), unwrap,
 * and on failure an audited + throttled rejection. `via` names the calling
 * action in the audit trail.
 */
async function requireDek(
  ctx: Awaited<ReturnType<typeof requireVaultActor>>,
  settings: SettingsRow,
  password: string,
  via: string,
): Promise<{ dek: Buffer } | { failed: { ok: false; message: string } }> {
  if (settings.lockedUntil && settings.lockedUntil.getTime() > Date.now()) {
    const mins = Math.max(1, Math.ceil((settings.lockedUntil.getTime() - Date.now()) / 60_000));
    return {
      failed: fail(`Too many failed attempts. Try again in ${mins} min.`),
    };
  }

  const kek = await deriveKek(password, settings.kdfSalt, storedParams(settings));
  let dek: Buffer;
  try {
    dek = unwrapDek(kek, settings.wrappedDek);
  } catch {
    // Wrong password. Count it (locking out at the threshold), audit, slow down.
    await db
      .update(vaultSettings)
      .set({
        failedAttempts: sql`${vaultSettings.failedAttempts} + 1`,
        lockedUntil: sql`case when ${vaultSettings.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS}
          then now() + (${LOCKOUT_MINUTES} || ' minutes')::interval
          else ${vaultSettings.lockedUntil} end`,
      })
      .where(eq(vaultSettings.id, settings.id));
    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault',
      entityId: settings.id,
      action: 'update',
      changes: { event: 'unlock_failed', via },
    });
    await sleep(FAIL_DELAY_MS);
    return { failed: fail(WRONG_PASSWORD) };
  }

  if (settings.failedAttempts > 0 || settings.lockedUntil) {
    await db
      .update(vaultSettings)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(vaultSettings.id, settings.id));
  }
  return { dek };
}

/* -------------------------------------------------------------------------- */
/* Status / setup                                                             */
/* -------------------------------------------------------------------------- */

export async function getVaultStatus(): Promise<VaultStatusResult> {
  try {
    await requireVaultActor();
    const settings = await loadSettings();
    const items = await db
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(isNull(vaultItems.deletedAt));
    return { ok: true, configured: settings !== null, itemCount: items.length };
  } catch (e) {
    if (e instanceof AppError) {
      return { ok: false, denied: e.kind === 'forbidden', message: e.message };
    }
    console.error('[settings/vault] status error:', e);
    return { ok: false, denied: false, message: 'Could not load the vault.' };
  }
}

export async function setupVault(password: string): Promise<VaultActionResult> {
  try {
    const ctx = await requireVaultActor();
    const pw = PasswordSchema.parse(password);

    const salt = newSalt();
    const dek = newDek();
    const kek = await deriveKek(pw, salt, DEFAULT_KDF_PARAMS);
    // The partial unique index (one live row) makes the concurrent-setup race
    // safe: the loser inserts nothing and is told the vault already exists.
    const rows = await db
      .insert(vaultSettings)
      .values({
        kdfSalt: salt,
        kdfParams: DEFAULT_KDF_PARAMS,
        wrappedDek: wrapDek(kek, dek),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: vaultSettings.id });
    if (rows.length === 0) {
      return fail('The vault is already set up. Unlock it with its password.');
    }

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault',
      entityId: rows[0]!.id,
      action: 'insert',
      changes: { event: 'vault_created' },
    });
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Unlock / read                                                              */
/* -------------------------------------------------------------------------- */

export async function unlockVault(password: string): Promise<VaultUnlockResult> {
  try {
    const ctx = await requireVaultActor();
    const settings = await loadSettings();
    if (!settings) return fail('The vault is not set up yet.');

    const gate = await requireDek(ctx, settings, password, 'unlock');
    if ('failed' in gate) return gate.failed;
    const { dek } = gate;

    // Opportunistic KDF upgrade: if this vault was wrapped under weaker
    // params than today's defaults, re-wrap now while we hold the password.
    if (storedParams(settings).N < DEFAULT_KDF_PARAMS.N) {
      const salt = newSalt();
      const kek = await deriveKek(password, salt, DEFAULT_KDF_PARAMS);
      await db
        .update(vaultSettings)
        .set({
          kdfSalt: salt,
          kdfParams: DEFAULT_KDF_PARAMS,
          wrappedDek: wrapDek(kek, dek),
          updatedBy: ctx.userId,
        })
        .where(eq(vaultSettings.id, settings.id));
    }

    const rows = await db
      .select()
      .from(vaultItems)
      .where(isNull(vaultItems.deletedAt))
      .orderBy(asc(vaultItems.sortOrder), asc(vaultItems.title));

    // One corrupt blob must not brick the whole vault — flag it instead so
    // the UI can offer deletion while every intact entry stays readable.
    const items: VaultItem[] = rows.map((r) => {
      try {
        const secret = decryptJson<ItemSecret>(dek, r.data);
        return {
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt.toISOString(),
          username: secret.username ?? '',
          password: secret.password ?? '',
          url: secret.url ?? '',
          notes: secret.notes ?? '',
        };
      } catch {
        console.error('[settings/vault] item failed to decrypt:', r.id);
        return {
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt.toISOString(),
          username: '',
          password: '',
          url: '',
          notes: '',
          corrupted: true,
        };
      }
    });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault',
      entityId: settings.id,
      action: 'update',
      changes: { event: 'unlocked', items: items.length },
    });
    return { ok: true, items };
  } catch (e) {
    return toErr(e);
  }
}

/* -------------------------------------------------------------------------- */
/* Mutations — each requires the vault password (the server holds no session) */
/* -------------------------------------------------------------------------- */

export async function createVaultItem(
  vaultPassword: string,
  input: VaultItemInput,
): Promise<VaultActionResult> {
  try {
    const ctx = await requireVaultActor();
    const v = ItemInputSchema.parse(input);
    const settings = await loadSettings();
    if (!settings) return fail('The vault is not set up yet.');
    const gate = await requireDek(ctx, settings, vaultPassword, 'create_item');
    if ('failed' in gate) return gate.failed;

    const secret: ItemSecret = {
      username: v.username,
      password: v.password,
      url: v.url,
      notes: v.notes,
    };
    const [row] = await db
      .insert(vaultItems)
      .values({
        title: v.title,
        data: encryptJson(gate.dek, secret),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: vaultItems.id });

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault_item',
      entityId: row!.id,
      action: 'insert',
      changes: { title: v.title },
    });
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function updateVaultItem(
  vaultPassword: string,
  id: string,
  input: VaultItemInput,
): Promise<VaultActionResult> {
  try {
    const ctx = await requireVaultActor();
    const itemId = z.string().uuid().parse(id);
    const v = ItemInputSchema.parse(input);
    const settings = await loadSettings();
    if (!settings) return fail('The vault is not set up yet.');
    const gate = await requireDek(ctx, settings, vaultPassword, 'update_item');
    if ('failed' in gate) return gate.failed;

    const [existing] = await db
      .select({ id: vaultItems.id })
      .from(vaultItems)
      .where(eq(vaultItems.id, itemId))
      .limit(1);
    if (!existing) return fail('Entry not found.');

    const secret: ItemSecret = {
      username: v.username,
      password: v.password,
      url: v.url,
      notes: v.notes,
    };
    await db
      .update(vaultItems)
      .set({ title: v.title, data: encryptJson(gate.dek, secret), updatedBy: ctx.userId })
      .where(eq(vaultItems.id, itemId));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault_item',
      entityId: itemId,
      action: 'update',
      changes: { title: v.title },
    });
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteVaultItem(
  vaultPassword: string,
  id: string,
): Promise<VaultActionResult> {
  try {
    const ctx = await requireVaultActor();
    const itemId = z.string().uuid().parse(id);
    const settings = await loadSettings();
    if (!settings) return fail('The vault is not set up yet.');
    const gate = await requireDek(ctx, settings, vaultPassword, 'delete_item');
    if ('failed' in gate) return gate.failed;

    const [existing] = await db
      .select({ id: vaultItems.id, title: vaultItems.title })
      .from(vaultItems)
      .where(eq(vaultItems.id, itemId))
      .limit(1);
    if (!existing) return fail('Entry not found.');

    // HARD delete — leaving ciphertext at rest under a retired entry serves
    // no one; the audit row keeps the title for history.
    await db.delete(vaultItems).where(eq(vaultItems.id, itemId));

    await logAudit({
      actorId: ctx.userId,
      entityType: 'vault_item',
      entityId: itemId,
      action: 'delete',
      changes: { title: existing.title },
    });
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

export async function changeVaultPassword(
  oldPassword: string,
  newPassword: string,
): Promise<VaultActionResult> {
  try {
    const ctx = await requireVaultActor();
    const newPw = PasswordSchema.parse(newPassword);
    const settings = await loadSettings();
    if (!settings) return fail('The vault is not set up yet.');
    const gate = await requireDek(ctx, settings, oldPassword, 'change_password');
    if ('failed' in gate) return { ok: false, message: 'The current vault password is wrong.' };
    const oldDek = gate.dek;

    // ROTATE the DEK and re-encrypt every item, so an old password plus an
    // old backup of vault_settings cannot decrypt anything written after
    // this change. Items are few and tiny — one transaction is cheap.
    const freshDek = newDek();
    const salt = newSalt();
    const kek = await deriveKek(newPw, salt, DEFAULT_KDF_PARAMS);

    await db.transaction(async (tx) => {
      // Purge any legacy soft-deleted ciphertext while we're re-keying.
      await tx.delete(vaultItems).where(isNotNull(vaultItems.deletedAt));

      const rows = await tx.select().from(vaultItems);
      for (const r of rows) {
        let secret: ItemSecret;
        try {
          secret = decryptJson<ItemSecret>(oldDek, r.data);
        } catch {
          continue; // corrupted under the old key — undecryptable either way
        }
        await tx
          .update(vaultItems)
          .set({ data: encryptJson(freshDek, secret), updatedBy: ctx.userId })
          .where(eq(vaultItems.id, r.id));
      }

      await tx
        .update(vaultSettings)
        .set({
          kdfSalt: salt,
          kdfParams: DEFAULT_KDF_PARAMS,
          wrappedDek: wrapDek(kek, freshDek),
          failedAttempts: 0,
          lockedUntil: null,
          updatedBy: ctx.userId,
        })
        .where(eq(vaultSettings.id, settings.id));

      await logAudit(
        {
          actorId: ctx.userId,
          entityType: 'vault',
          entityId: settings.id,
          action: 'update',
          changes: { event: 'password_changed', dek_rotated: true },
        },
        tx as unknown as typeof db,
      );
    });
    return { ok: true };
  } catch (e) {
    return toErr(e);
  }
}

function toErr(e: unknown): { ok: false; message: string } {
  if (e instanceof AppError) return fail(e.message);
  if (e instanceof z.ZodError) return fail(e.issues.map((i) => i.message).join(' '));
  console.error('[settings/vault] action error:', e);
  return fail('Something went wrong. Please try again.');
}
