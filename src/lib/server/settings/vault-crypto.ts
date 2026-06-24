import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  type ScryptOptions,
} from 'node:crypto';

// promisify() collapses scrypt's overloads to the options-less one — wrap by hand.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Envelope crypto for Settings → Vault.
 *
 *   vault password ──scrypt(salt)──▶ KEK ──AES-256-GCM──▶ wraps DEK
 *   DEK ──AES-256-GCM (per-item IV)──▶ encrypts each credential JSON
 *
 * The GCM auth tag makes every unwrap/decrypt self-verifying: a wrong
 * password fails to unwrap the DEK, so no separate password hash exists to
 * attack. Changing the password only re-wraps the DEK (items untouched).
 *
 * Blob layout everywhere: iv(12) ‖ tag(16) ‖ ciphertext.
 */

export type KdfParams = { N: number; r: number; p: number; keylen: number };

/**
 * scrypt cost parameters. N is the CPU/memory cost factor (NOT an iteration
 * count) — 2^17 with r=8 needs ~128 MiB per derivation, the OWASP minimum
 * for an offline-attackable verifier (the wrapped DEK in a DB dump is
 * exactly that). Stored per-vault so they can be raised later; unlockVault
 * opportunistically re-wraps vaults whose stored params are weaker.
 */
export const DEFAULT_KDF_PARAMS: KdfParams = { N: 131072, r: 8, p: 1, keylen: 32 };

const IV_LEN = 12;
const TAG_LEN = 16;

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function newDek(): Buffer {
  return randomBytes(32);
}

export async function deriveKek(
  password: string,
  salt: Buffer,
  params: KdfParams,
): Promise<Buffer> {
  // NFKC so the same password typed via different keyboards/IMEs (composed vs
  // decomposed Unicode) derives the same key. No-op for ASCII.
  return scrypt(password.normalize('NFKC'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2,
  });
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/** Throws on a bad key or tampered blob (GCM tag mismatch). */
function open(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function wrapDek(kek: Buffer, dek: Buffer): Buffer {
  return seal(kek, dek);
}

/** Throws when the password (→ KEK) is wrong. */
export function unwrapDek(kek: Buffer, wrapped: Buffer): Buffer {
  return open(kek, wrapped);
}

export function encryptJson(dek: Buffer, value: unknown): Buffer {
  return seal(dek, Buffer.from(JSON.stringify(value), 'utf8'));
}

export function decryptJson<T>(dek: Buffer, blob: Buffer): T {
  return JSON.parse(open(dek, blob).toString('utf8')) as T;
}
