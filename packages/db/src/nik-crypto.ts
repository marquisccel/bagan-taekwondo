import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { DomainError } from '@bagantkd/shared';

/**
 * NIK at rest (ADR-0014): AES-256-GCM ciphertext plus an HMAC-SHA-256 blind index for identity
 * matching without decryption. Keys are 32 bytes each, provisioned per deployment; the two keys
 * must differ. Ciphertext layout: 12-byte IV ‖ ciphertext ‖ 16-byte tag.
 */
export interface NikKeys {
  readonly encryptionKey: Uint8Array;
  readonly blindIndexKey: Uint8Array;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

function checkKeys(keys: NikKeys): void {
  if (keys.encryptionKey.length !== 32 || keys.blindIndexKey.length !== 32) {
    throw new DomainError('NIK_KEY_INVALID', {}, 'NIK keys must be 32 bytes each');
  }
  if (Buffer.from(keys.encryptionKey).equals(Buffer.from(keys.blindIndexKey))) {
    throw new DomainError('NIK_KEY_INVALID', {}, 'encryption and blind-index keys must differ');
  }
}

/** Reads base64 keys from NIK_ENCRYPTION_KEY and NIK_BLIND_INDEX_KEY. */
export function nikKeysFromEnv(env: Readonly<Record<string, string | undefined>>): NikKeys {
  const enc = env['NIK_ENCRYPTION_KEY'];
  const idx = env['NIK_BLIND_INDEX_KEY'];
  if (!enc || !idx)
    throw new DomainError('NIK_KEY_MISSING', {}, 'NIK_ENCRYPTION_KEY and NIK_BLIND_INDEX_KEY are required');
  const keys = { encryptionKey: Buffer.from(enc, 'base64'), blindIndexKey: Buffer.from(idx, 'base64') };
  checkKeys(keys);
  return keys;
}

export function encryptNik(nik: string, keys: NikKeys): Uint8Array {
  checkKeys(keys);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keys.encryptionKey, iv);
  const body = Buffer.concat([cipher.update(nik, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function decryptNik(ciphertext: Uint8Array, keys: NikKeys): string {
  checkKeys(keys);
  const buf = Buffer.from(ciphertext);
  if (buf.length < IV_BYTES + TAG_BYTES)
    throw new DomainError('NIK_CIPHERTEXT_INVALID', {}, 'ciphertext too short');
  const decipher = createDecipheriv('aes-256-gcm', keys.encryptionKey, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES, buf.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

/** Deterministic, keyed: equal NIKs give equal indexes; the index reveals nothing without the key. */
export function nikBlindIndex(nik: string, keys: NikKeys): string {
  checkKeys(keys);
  return createHmac('sha256', keys.blindIndexKey).update(nik, 'utf8').digest('hex');
}
