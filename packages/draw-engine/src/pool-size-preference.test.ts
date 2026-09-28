import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildCandidates,
  dpPartition,
  rankCandidates,
  resolvePolicy,
  type PoolEntry,
  type ResolvedPolicy,
} from './pooling.js';

/**
 * 2026-09 pool-size preference (tournament policy): maximize the use of 3- and 4-participant pools,
 * minimize 2-participant pools (created only when a decomposition using only 3s and 4s is
 * impossible), preserve the existing maximum pool size of 4, and preserve the existing singleton
 * domain case (a category of exactly 1 entry, or another pre-existing forced-singleton scenario,
 * untouched by this change). See `pooling.ts`'s `dpPartition`/`localSearch` for the implementation
 * (a new [singleton, twoPerson] priority level, ranked between tier0 and tier1).
 */

const ruleSet = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;
const policy = (code: string): ResolvedPolicy =>
  resolvePolicy(
    ruleSet,
    ruleSet.poolPolicies.find((p) => p.code === code) ?? (ruleSet.poolPolicies[0] as never),
    'CADET',
  );
const KYORUGI = policy('KYORUGI_SEMI_POOL');

/** Entries with identical physical values everywhere: every possible grouping has zero physical
 * (tier1 deviation) cost, so the resulting pool-size decomposition reflects ONLY the pool-size-shape
 * priority and the existing sizePenaltyFp tie-break between 3s and 4s -- never incidental tolerance
 * differences between specific entries. This is the cleanest way to test a purely combinatorial
 * policy without also asserting on unrelated physical-grouping behavior. */
function identicalEntries(n: number): PoolEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${String(i).padStart(3, '0')}`,
    weightG: 45_000,
    heightMm: 1600,
    beltRank: 3,
    contingent: `K${i}`, // distinct contingents: never lets Tier 2/3 contingent-spread influence shape
  }));
}

/** The pool selected by the full pipeline (DP + local search + candidate ranking) for `n` entries. */
function selectedSizes(n: number): number[] {
  const cands = buildCandidates(identicalEntries(n), KYORUGI, parseDrawSeed('42'), `cat-${n}`);
  const best = rankCandidates(cands)[0];
  if (!best) throw new Error('no candidate produced');
  return best.pools.map((p) => p.length).sort((a, b) => a - b);
}

/**
 * The exact decomposition matrix confirmed by the tournament team (1–20). 17–20 are the
 * deterministic continuation of the same rule, derived (not given) as follows: among all
 * decompositions of n into parts of 3 and 4 with zero singletons and zero 2-person pools, prefer the
 * one using the MOST 4s (each 4 costs 0 in `sizePenaltyFp`, each 3 costs more) -- i.e. the largest
 * a such that `n - 4*a` is a non-negative multiple of 3:
 *   17 = 4*2 + 3*3  -> {4,4,3,3,3}
 *   18 = 4*3 + 3*2  -> {4,4,4,3,3}
 *   19 = 4*4 + 3*1  -> {4,4,4,4,3}
 *   20 = 4*5 + 3*0  -> {4,4,4,4,4}
 */
const EXPECTED: Readonly<Record<number, readonly number[]>> = {
  1: [1],
  2: [2],
  3: [3],
  4: [4],
  5: [2, 3],
  6: [3, 3],
  7: [3, 4],
  8: [4, 4],
  9: [3, 3, 3],
  10: [3, 3, 4],
  11: [3, 4, 4],
  12: [4, 4, 4],
  13: [3, 3, 3, 4],
  14: [3, 3, 4, 4],
  15: [3, 4, 4, 4],
  16: [4, 4, 4, 4],
  17: [3, 3, 3, 4, 4],
  18: [3, 3, 4, 4, 4],
  19: [3, 4, 4, 4, 4],
  20: [4, 4, 4, 4, 4],
};

describe('pool-size preference (2026-09): explicit 1–20 decomposition matrix', () => {
  for (const [nStr, expected] of Object.entries(EXPECTED)) {
    const n = Number(nStr);
    it(`${n} -> ${expected.join('+')}`, () => {
      expect(selectedSizes(n)).toEqual([...expected]);
    });
  }
});

describe('pool-size preference: property tests', () => {
  it('no pool ever exceeds the existing maximum pool size of 4', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (n) => {
        for (const size of selectedSizes(n)) expect(size).toBeLessThanOrEqual(KYORUGI.poolMax);
      }),
      { numRuns: 60 },
    );
  });

  it('for N >= 6, no 2-person pool is ever produced when N can be represented entirely by 3s and 4s', () => {
    const representableBy3sAnd4s = (n: number): boolean => {
      for (let a = 0; a * 4 <= n; a += 1) if ((n - a * 4) % 3 === 0) return true;
      return false;
    };
    fc.assert(
      fc.property(fc.integer({ min: 6, max: 60 }), (n) => {
        fc.pre(representableBy3sAnd4s(n));
        const sizes = selectedSizes(n);
        expect(sizes).not.toContain(1);
        expect(sizes).not.toContain(2);
      }),
      { numRuns: 60 },
    );
  });

  it('participant conservation: every entry appears in exactly one pool, none invented or dropped', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (n) => {
        const entries = identicalEntries(n);
        const cands = buildCandidates(entries, KYORUGI, parseDrawSeed('7'), `cat-${n}`);
        const best = rankCandidates(cands)[0];
        const ids = best?.pools.flatMap((p) => p.map((e) => e.id)) ?? [];
        expect([...ids].sort()).toEqual(entries.map((e) => e.id).sort());
      }),
      { numRuns: 40 },
    );
  });

  it('no duplicate entries within or across pools', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (n) => {
        const cands = buildCandidates(identicalEntries(n), KYORUGI, parseDrawSeed('7'), `cat-${n}`);
        const best = rankCandidates(cands)[0];
        const ids = best?.pools.flatMap((p) => p.map((e) => e.id)) ?? [];
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 40 },
    );
  });

  it('deterministic: the same entries, policy and seed always produce the same decomposition', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (n) => {
        const a = selectedSizes(n);
        const b = selectedSizes(n);
        expect(a).toEqual(b);
      }),
      { numRuns: 40 },
    );
  });

  it('local search never undoes the DP-chosen shape for a marginal physical/contingent gain', () => {
    // Regression guard for the local-search guard added in `localSearch`'s `tryChanges`: running the
    // full tier1 -> tier2 -> tier3 pipeline must not change the pool-size multiset the DP produced.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (n) => {
        const ordered = identicalEntries(n);
        const dp = dpPartition(ordered, KYORUGI, false);
        const dpSizes = dp.map((p) => p.length).sort((a, b) => a - b);
        expect(selectedSizes(n)).toEqual(dpSizes);
      }),
      { numRuns: 30 },
    );
  });
});
