import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { canonicalJson } from './canonical-json.js';

/** Fingerprint format stored in the database and in simulator manifests. */
export type Fingerprint = `sha256:${string}`;

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  return sha256(typeof input === 'string' ? utf8ToBytes(input) : input);
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(input));
}

/** Fingerprint of a value's canonical JSON. Identical values always produce identical fingerprints. */
export function fingerprint(value: unknown): Fingerprint {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function fingerprintBytes(bytes: Uint8Array): Fingerprint {
  return `sha256:${sha256Hex(bytes)}`;
}
