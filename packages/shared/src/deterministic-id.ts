import { bytesToHex } from '@noble/hashes/utils.js';

import { sha256Bytes } from './hash.js';

export type Uuid = string & { readonly __brand: 'Uuid' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): value is Uuid {
  return UUID_RE.test(value);
}

/**
 * Name-based UUID (RFC 9562 version 8, SHA-256 derived). The engine never calls a random
 * UUID generator: stable logical identities such as pool_uid and match_uid are derived
 * from (namespace, name), so a replay produces the same identifiers.
 */
export function deterministicUuid(namespace: string, name: string): Uuid {
  const bytes = sha256Bytes(`${namespace}\u0000${name}`).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80; // version 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}
