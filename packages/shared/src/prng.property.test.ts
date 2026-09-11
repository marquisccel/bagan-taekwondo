import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseDrawSeed, Prng } from './prng.js';

const seedArb = fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }).map((n) => parseDrawSeed(n.toString()));

describe('Prng properties', () => {
  it('replays identically for the same seed and label', () => {
    fc.assert(
      fc.property(seedArb, fc.string(), (seed, label) => {
        const a = Prng.fromSeed(seed, label);
        const b = Prng.fromSeed(seed, label);
        for (let i = 0; i < 16; i += 1) {
          expect(a.nextUint32()).toBe(b.nextUint32());
        }
      }),
    );
  });

  it('nextBelow always returns an integer in [0, bound)', () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 1, max: 2 ** 32 }), (seed, bound) => {
        const g = Prng.fromSeed(seed, 'bound');
        for (let i = 0; i < 8; i += 1) {
          const v = g.nextBelow(bound);
          expect(Number.isInteger(v) && v >= 0 && v < bound).toBe(true);
        }
      }),
    );
  });

  it('shuffled returns a permutation of its input', () => {
    fc.assert(
      fc.property(seedArb, fc.array(fc.integer(), { maxLength: 64 }), (seed, items) => {
        const out = Prng.fromSeed(seed, 'perm').shuffled(items);
        expect(out.slice().sort((x, y) => x - y)).toEqual(items.slice().sort((x, y) => x - y));
      }),
    );
  });
});
