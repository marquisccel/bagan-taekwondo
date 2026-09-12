import { parseDrawSeed } from '@bagantkd/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildBracket, checkBracket, standardRanks, type BracketEntry } from './bracket.js';

const entries = (n: number, contingents: number, seeds: number): BracketEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(3, '0')}`,
    contingent: `K${i % Math.max(1, contingents)}`,
    seedNo: i < seeds ? i + 1 : null,
  }));

describe('bracket structure (INV-04)', () => {
  it('n = 1…512: power-of-two size, byes, every entry once, no bye-vs-bye, balanced halves, n−1 real matches, one final, valid progression', () => {
    for (let n = 1; n <= 512; n += 1) {
      const es = entries(n, 1 + (n % 7), 0);
      const b = buildBracket({
        entries: es,
        seed: parseDrawSeed(String(n)),
        label: `n${n}`,
        byePolicy: 'RANDOM_SEEDED',
        budgetPerEntry: 20,
      });
      expect(checkBracket(b, es), `n=${n}`).toEqual([]);
    }
  });

  it('the contingent-aware placement keeps every structural invariant (n = 1…64 and sampled n ≤ 512)', () => {
    const ns = [
      ...Array.from({ length: 64 }, (_, i) => i + 1),
      65,
      100,
      127,
      128,
      129,
      200,
      255,
      256,
      257,
      511,
      512,
    ];
    for (const n of ns) {
      const es = entries(n, 1 + (n % 7), 0);
      const b = buildBracket({
        entries: es,
        seed: parseDrawSeed(String(n)),
        label: `n${n}`,
        byePolicy: 'CONTINGENT_AWARE',
        budgetPerEntry: 20,
      });
      expect(checkBracket(b, es), `n=${n}`).toEqual([]);
    }
  });

  it('small cases n = 1…8 have the exact expected shape', () => {
    const expected: Record<number, [number, number, number]> = {
      1: [2, 1, 0],
      2: [2, 0, 1],
      3: [4, 1, 2],
      4: [4, 0, 3],
      5: [8, 3, 4],
      6: [8, 2, 5],
      7: [8, 1, 6],
      8: [8, 0, 7],
    };
    for (let n = 1; n <= 8; n += 1) {
      const b = buildBracket({
        entries: entries(n, 2, 0),
        seed: parseDrawSeed('1'),
        label: 'x',
        byePolicy: 'CONTINGENT_AWARE',
        budgetPerEntry: 20,
      });
      expect([b.size, b.byes, b.matches.filter((m) => m.real).length], `n=${n}`).toEqual(expected[n]);
    }
  });

  it('standard seeding: ranks 1 and 2 meet only in the final; rank r meets S+1−r in round 1', () => {
    for (const s of [2, 4, 8, 16, 32]) {
      const r = standardRanks(s);
      expect(r.indexOf(1) < s / 2).not.toBe(r.indexOf(2) < s / 2);
      for (let p = 0; p < s; p += 2) expect((r[p] ?? 0) + (r[p + 1] ?? 0)).toBe(s + 1);
    }
  });

  it('INV-08: manual seeds keep their slot for every seed and every n', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 40 }),
        fc.integer({ min: 1, max: 8 }),
        fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
        (n, k, s) => {
          const es = entries(n, 3, Math.min(k, n));
          const b = buildBracket({
            entries: es,
            seed: parseDrawSeed(s.toString()),
            label: 'seeded',
            byePolicy: 'CONTINGENT_AWARE',
            budgetPerEntry: 20,
          });
          expect(checkBracket(b, es)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('deterministic for the same seed', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (n, s) => {
        const args = {
          entries: entries(n, 4, 0),
          seed: parseDrawSeed(s.toString()),
          label: 'd',
          byePolicy: 'CONTINGENT_AWARE',
          budgetPerEntry: 20,
        };
        expect(buildBracket(args)).toEqual(buildBracket(args));
      }),
      { numRuns: 100 },
    );
  });
});
