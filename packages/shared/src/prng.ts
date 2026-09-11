import { DomainError, invariant } from './errors.js';
import { sha256Bytes } from './hash.js';

/**
 * A draw seed is an unsigned 64-bit integer written in decimal. Keeping it a short decimal
 * string makes it easy to print on reports and to type back in for a replay.
 */
export type DrawSeed = string & { readonly __brand: 'DrawSeed' };

const MAX_U64 = (1n << 64n) - 1n;
const DERIVATION_PREFIX = 'bagantkd/prng/xoshiro128ss/v1';

export function parseDrawSeed(input: string): DrawSeed {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(input) || BigInt(input) > MAX_U64) {
    throw new DomainError('INVALID_DRAW_SEED', { input });
  }
  return input as DrawSeed;
}

/**
 * Seeded pseudo-random generator: xoshiro128** (Blackman & Vigna).
 *
 * The 128-bit state is derived as SHA-256(prefix NUL seed NUL label)[0..16], read as four
 * little-endian uint32 words. Deriving a separate stream per label (e.g. per category key)
 * means re-drawing one category never shifts the random sequence of another.
 *
 * Only 32-bit integer operations are used, so the sequence is bit-identical on every
 * JavaScript engine.
 */
export class Prng {
  #s0: number;
  #s1: number;
  #s2: number;
  #s3: number;

  private constructor(state: readonly [number, number, number, number]) {
    [this.#s0, this.#s1, this.#s2, this.#s3] = state;
    invariant((this.#s0 | this.#s1 | this.#s2 | this.#s3) !== 0, 'PRNG_ZERO_STATE');
  }

  static fromSeed(seed: DrawSeed, label: string): Prng {
    const digest = sha256Bytes(`${DERIVATION_PREFIX}\u0000${seed}\u0000${label}`);
    const view = new DataView(digest.buffer, digest.byteOffset, 16);
    const words: [number, number, number, number] = [
      view.getUint32(0, true),
      view.getUint32(4, true),
      view.getUint32(8, true),
      view.getUint32(12, true),
    ];
    if ((words[0] | words[1] | words[2] | words[3]) === 0) {
      words[0] = 1; // unreachable in practice; keeps the generator well-defined
    }
    return new Prng(words);
  }

  /** Next uint32 in [0, 2^32). */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.#s1, 5), 7), 9) >>> 0;
    const t = (this.#s1 << 9) >>> 0;
    this.#s2 = (this.#s2 ^ this.#s0) >>> 0;
    this.#s3 = (this.#s3 ^ this.#s1) >>> 0;
    this.#s1 = (this.#s1 ^ this.#s2) >>> 0;
    this.#s0 = (this.#s0 ^ this.#s3) >>> 0;
    this.#s2 = (this.#s2 ^ t) >>> 0;
    this.#s3 = rotl(this.#s3, 11);
    return result;
  }

  /** Uniform integer in [0, bound) without modulo bias. `bound` must be in [1, 2^32]. */
  nextBelow(bound: number): number {
    invariant(Number.isInteger(bound) && bound >= 1 && bound <= 2 ** 32, 'PRNG_INVALID_BOUND', { bound });
    const limit = 2 ** 32 - (2 ** 32 % bound);
    for (;;) {
      const r = this.nextUint32();
      if (r < limit) return r % bound;
    }
  }

  /** Returns a new array; Fisher–Yates from the end. The input is not modified. */
  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.nextBelow(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
