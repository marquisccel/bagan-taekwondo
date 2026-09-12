import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { FP_SCALE, parseDrawSeed, Prng } from '@bagantkd/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { exhaustivePartition } from './exhaustive.js';
import {
  buildCandidates,
  DEVIATION_CAP_FP,
  deviationFp,
  dpPartition,
  localSearch,
  newStats as freshStats,
  minSameContingentRound1,
  poolCost,
  rankCandidates,
  resolvePolicy,
  STRATEGY_ORDER,
  type PoolEntry,
  type ResolvedPolicy,
  type SearchStats,
} from './pooling.js';

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
const POOMSAE = policy('POOMSAE_SEMI_POOL');

const entryArb = (i: number) =>
  fc
    .record({
      weightG: fc.integer({ min: 30_000, max: 60_000 }),
      heightMm: fc.integer({ min: 1300, max: 1800 }),
      beltRank: fc.integer({ min: 1, max: 7 }),
      contingent: fc.constantFrom('A', 'B', 'C', 'D'),
    })
    .map((r): PoolEntry => ({ id: `e${String(i).padStart(3, '0')}`, ...r }));
const categoryArb = (min: number, max: number) =>
  fc.integer({ min, max }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => entryArb(i))));
const newStats = (): SearchStats => freshStats();
const ids = (pools: readonly (readonly PoolEntry[])[]) =>
  pools
    .flat()
    .map((e) => e.id)
    .sort();

describe('pool cost (ADR-0008 Tier 1)', () => {
  it('deviationFp = min(cap, floor(FP·(a·x + b·max(0, x−1)²))) exactly, x = range/ideal', () => {
    fc.assert(
      fc.property(
        fc.nat(2_000_000),
        fc.integer({ min: 1, max: 100_000 }),
        fc.nat(10_000),
        fc.nat(10_000),
        (range, ideal, a, b) => {
          const S = BigInt(FP_SCALE);
          const lin = (BigInt(a) * BigInt(range) * S) / (1000n * BigInt(ideal));
          const over =
            range > ideal
              ? (BigInt(b) * BigInt(range - ideal) ** 2n * S) / (1000n * BigInt(ideal) ** 2n)
              : 0n;
          const exact = lin + over;
          const expected = exact > BigInt(DEVIATION_CAP_FP) ? DEVIATION_CAP_FP : Number(exact);
          expect(deviationFp(range, { ideal, linearPermille: a, overflowPermille: b })).toBe(expected);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('minimum same-contingent round-1 meetings equals brute force over byes and pairings', () => {
    const brute = (cs: readonly string[]): number => {
      const k = cs.length;
      if (k < 2) return 0;
      let s = 2;
      while (s < k) s *= 2;
      const byes = s - k;
      let best = Infinity;
      const rec = (rest: string[], byesLeft: number, same: number) => {
        if (rest.length === 0) {
          best = Math.min(best, same);
          return;
        }
        const [x, ...others] = rest as [string, ...string[]];
        if (byesLeft > 0) rec(others, byesLeft - 1, same);
        for (let j = 0; j < others.length; j += 1) {
          rec(
            others.filter((_, q) => q !== j),
            byesLeft,
            same + (others[j] === x ? 1 : 0),
          );
        }
      };
      rec([...cs], byes, 0);
      return best;
    };
    fc.assert(
      fc.property(fc.array(fc.constantFrom('A', 'B', 'C'), { minLength: 1, maxLength: 8 }), (cs) => {
        const counts = ['A', 'B', 'C'].map((c) => cs.filter((x) => x === c).length);
        expect(minSameContingentRound1([Math.max(...counts)], cs.length)).toBe(brute(cs));
      }),
      { numRuns: 500 },
    );
  });
});

describe('strategies and optimization', () => {
  it('DP is optimal over contiguous partitions of its ordering (brute force, n ≤ 10)', () => {
    fc.assert(
      fc.property(categoryArb(1, 10), (es) => {
        const dp = dpPartition(es, KYORUGI, false);
        const cost = (pools: readonly (readonly PoolEntry[])[]) =>
          pools.reduce<[number, number]>(
            (acc, p) => {
              const c = poolCost(p, KYORUGI);
              return [acc[0] + c.tier0, acc[1] + c.tier1];
            },
            [0, 0],
          );
        let best: [number, number] = [Infinity, Infinity];
        const rec = (i: number, acc: PoolEntry[][]) => {
          if (i === es.length) {
            const c = cost(acc);
            if (c[0] < best[0] || (c[0] === best[0] && c[1] < best[1])) best = c;
            return;
          }
          for (let k = 1; k <= Math.min(KYORUGI.poolMax, es.length - i); k += 1)
            rec(i + k, [...acc, es.slice(i, i + k)]);
        };
        rec(0, []);
        expect(cost(dp)).toEqual(best);
      }),
      { numRuns: 200 },
    );
  });

  it('every strategy yields a complete partition (each entry exactly once, pools ≤ poolMax); ranking is lexicographic', () => {
    fc.assert(
      fc.property(categoryArb(1, 30), fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (es, s) => {
        const cands = buildCandidates(es, KYORUGI, parseDrawSeed(s.toString()), 'cat');
        expect(cands.map((c) => c.strategy)).toEqual([...STRATEGY_ORDER]);
        for (const c of cands) {
          expect(ids(c.pools)).toEqual(es.map((e) => e.id).sort());
          expect(c.pools.every((p) => p.length >= 1 && p.length <= KYORUGI.poolMax)).toBe(true);
          expect(c.tier1PhaseCost[1]).toBeLessThanOrEqual(c.dpCost[1]);
        }
        const ranked = rankCandidates(cands);
        for (let i = 1; i < ranked.length; i += 1) {
          const [a, b] = [ranked[i - 1]?.cost ?? [0, 0, 0], ranked[i]?.cost ?? [0, 0, 0]];
          expect(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])))).toBe(
            true,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('ADR-0008 no-regression: every accepted Tier-2 change lowers Tier 2, keeps pools inside their ideal, creates no singleton and stays within the slack', () => {
    fc.assert(
      fc.property(categoryArb(4, 24), (es) => {
        for (const p of [KYORUGI, POOMSAE]) {
          const start = localSearch(dpPartition(es, p, false), p, 'tier1', newStats());
          localSearch(start, p, 'tier2', newStats(), (ch) => {
            const t2 = (xs: readonly ({ tier2: number } | null)[]) =>
              xs.reduce((s, x) => s + (x?.tier2 ?? 0), 0);
            expect(t2(ch.after)).toBeLessThan(t2(ch.before));
            expect(ch.tier1Total).toBeLessThanOrEqual(ch.tier1Base + p.tier1SlackFp);
            ch.before.forEach((b, i) => {
              const a = ch.after[i];
              if (b && a) {
                b.ranges.forEach((r, d) => {
                  const ideal = p.dimensions[d]?.ideal ?? 0;
                  if (r <= ideal) expect(a.ranges[d]).toBeLessThanOrEqual(ideal);
                });
              }
              if (a && a.members === 1) expect(b?.members).toBe(1);
            });
          });
        }
      }),
      { numRuns: 150 },
    );
  });

  it('deterministic: same entries and seed give the same candidates', () => {
    fc.assert(
      fc.property(categoryArb(1, 20), (es) => {
        expect(buildCandidates(es, KYORUGI, parseDrawSeed('9'), 'k')).toEqual(
          buildCandidates(es, KYORUGI, parseDrawSeed('9'), 'k'),
        );
      }),
      { numRuns: 50 },
    );
  });
});

describe('exhaustive pooling comparison, n ≤ 10 (ACCEPTANCE §4)', () => {
  /**
   * Gaps are measured, not hidden: on uniformly random 3-D categories the Tier-1 heuristic misses
   * the exhaustive optimum in a few percent of cases (a 3-pool exchange is outside its moves).
   * The bound below is a regression guard; the exact figures are reported in PHASE3 docs.
   */
  it('Tier-1 heuristic vs exhaustive optimum on 400 random categories per policy', () => {
    const report: Record<string, { cases: number; gaps: number; maxRelGapPct: number }> = {};
    for (const [name, p] of [
      ['KYORUGI_SEMI_POOL', KYORUGI],
      ['POOMSAE_SEMI_POOL', POOMSAE],
    ] as const) {
      const rng = Prng.fromSeed(parseDrawSeed('7'), name);
      let gaps = 0;
      let maxRel = 0;
      for (let c = 0; c < 400; c += 1) {
        const n = 2 + rng.nextBelow(9);
        const es: PoolEntry[] = Array.from({ length: n }, (_, i) => ({
          id: `e${i}`,
          weightG: 40_000 + rng.nextBelow(8000),
          heightMm: 1400 + rng.nextBelow(250),
          beltRank: 1 + rng.nextBelow(7),
          contingent: `K${rng.nextBelow(3)}`,
        }));
        const heuristic = Math.min(
          ...buildCandidates(es, p, parseDrawSeed(String(c)), `c${c}`).map((x) => x.tier1PhaseCost[1]),
        );
        const optimum = exhaustivePartition(es, p).best[1];
        expect(heuristic).toBeGreaterThanOrEqual(optimum);
        if (heuristic > optimum) {
          gaps += 1;
          maxRel = Math.max(maxRel, (heuristic - optimum) / optimum);
        }
      }
      report[name] = { cases: 400, gaps, maxRelGapPct: Math.round(maxRel * 10_000) / 100 };
    }
    process.stdout.write(`  [exhaustive-pooling] ${JSON.stringify(report)}\n`);
    expect(report['KYORUGI_SEMI_POOL']?.gaps).toBeLessThanOrEqual(12);
    expect(report['KYORUGI_SEMI_POOL']?.maxRelGapPct).toBeLessThan(15);
    expect(report['POOMSAE_SEMI_POOL']?.gaps).toBe(0);
  });
});
