import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { parseDrawSeed } from '@bagantkd/shared';
import { describe, expect, it } from 'vitest';

import {
  buildCandidates,
  localSearch,
  newStats,
  poolCost,
  rankCandidates,
  resolvePolicy,
  type PoolEntry,
  type PoolingCandidate,
  type ResolvedPolicy,
} from './pooling.js';

/**
 * AUD-004: contingent separation stays SOFT (never Tier 0). When several distributions are equal on
 * Tier 0/1/2 the engine prefers the one that spreads outside contingents across pools — see
 * `docs/PHASE3_CALIBRATION.md` "Tier 3 — contingent spread".
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
  resolvePolicy(ruleSet, ruleSet.poolPolicies.find((p) => p.code === code) as never, 'CADET');
const KYORUGI = policy('KYORUGI_SEMI_POOL');
const POOMSAE = policy('POOMSAE_SEMI_POOL');

const entries = (contingents: readonly string[], weightsKg?: readonly number[]): PoolEntry[] =>
  contingents.map((contingent, i) => ({
    id: `e${String(i + 1).padStart(2, '0')}`,
    weightG: (weightsKg?.[i] ?? 50) * 1000,
    heightMm: 1600,
    beltRank: 5,
    contingent,
  }));

const best = (es: readonly PoolEntry[], p: ResolvedPolicy, seed = '777'): PoolingCandidate => {
  const top = rankCandidates(buildCandidates(es, p, parseDrawSeed(seed), 'K'))[0];
  if (!top) throw new Error('no candidate');
  return top;
};
/** Sorted contingent multiset of each pool, pools sorted — an order-independent shape. */
const shape = (c: PoolingCandidate): string[] =>
  c.pools
    .map((pool) =>
      pool
        .map((e) => e.contingent)
        .sort()
        .join(''),
    )
    .sort();

describe('AUD-004 — contingent spread tie-break (soft, deterministic)', () => {
  it('poolCost exposes the spread of a pool: sum of squared contingent group sizes', () => {
    const pool = (cs: string[]) => poolCost(entries(cs), KYORUGI).spread;
    expect(pool(['A', 'A', 'A', 'B'])).toBe(10);
    expect(pool(['A', 'A', 'B', 'C'])).toBe(6);
    expect(pool(['A', 'A', 'A', 'A'])).toBe(16);
    expect(pool(['A', 'B', 'C', 'D'])).toBe(4);
  });

  it('dominant contingent A=6,B=1,C=1: every pool gets an outsider (AAAB + AAAC), not AAAA + AABC', () => {
    for (const p of [KYORUGI, POOMSAE]) {
      const c = best(entries(['A', 'A', 'A', 'A', 'A', 'A', 'B', 'C']), p);
      expect(shape(c)).toEqual(['AAAB', 'AAAC']);
      expect(c.cost[0]).toBe(0);
      expect(c.cost[1]).toBe(0);
      expect(c.cost[2]).toBe(40_000); // unchanged: the spread rule never trades Tier 2 or Tier 1
    }
  });

  it('is deterministic and independent of input order and seed', () => {
    const base = entries(['A', 'A', 'A', 'A', 'A', 'A', 'B', 'C']);
    const reversed = [...base].reverse();
    for (const seed of ['1', '777', '20260827']) {
      expect(shape(best(base, KYORUGI, seed))).toEqual(['AAAB', 'AAAC']);
      expect(shape(best(reversed, KYORUGI, seed))).toEqual(['AAAB', 'AAAC']);
    }
    const a = best(base, KYORUGI);
    const b = best(base, KYORUGI);
    expect(a.pools).toEqual(b.pools);
  });

  it('perfectly diverse contingents: cost 0 everywhere, nothing to spread', () => {
    const c = best(entries(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), KYORUGI);
    expect(c.cost).toEqual([0, 0, 0]);
    expect(c.pools.map((p) => p.length)).toEqual([4, 4]);
  });

  it('two contingents 4+4: balanced AABB + AABB', () => {
    const c = best(entries(['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']), KYORUGI);
    expect(shape(c)).toEqual(['AABB', 'AABB']);
    expect(c.cost[0]).toBe(0);
  });

  it('one contingent only: still two valid pools, never infeasible, never blocked', () => {
    const c = best(entries(['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A']), KYORUGI);
    expect(shape(c)).toEqual(['AAAA', 'AAAA']);
    expect(c.cost[0]).toBe(0);
    expect(c.pools.every((p) => p.length >= 2)).toBe(true);
  });

  it('never overrides materially better weight grouping (Tier 1 is not spent on spread)', () => {
    // Light half all contingent A, heavy half A A B C: mixing B/C into the light pool would
    // widen both weight ranges from 3 kg to ~20 kg, so the physical grouping must win.
    const es = entries(['A', 'A', 'A', 'A', 'A', 'A', 'B', 'C'], [30, 31, 32, 33, 50, 51, 52, 53]);
    const c = best(es, KYORUGI);
    const ranges = c.pools.map((pool) => {
      const w = pool.map((e) => e.weightG as number);
      return Math.max(...w) - Math.min(...w);
    });
    expect(Math.max(...ranges)).toBeLessThanOrEqual(3_000);
    expect(c.cost[0]).toBe(0);
  });

  it('never widens a weight/height/belt range, even for a dimension the rule set switched off (Poomsae weight)', () => {
    // pool 1 = AAAA (light), pool 2 = AABC (heavy B/C). Swapping an A for B would spread the
    // contingents but stretch the pool's weight range from 3 kg to 20 kg. Poomsae weight is
    // inactive (Q5) so Tier 1 would not object — the Tier-3 phase itself must.
    const es = entries(['A', 'A', 'A', 'A', 'A', 'A', 'B', 'C'], [40, 41, 42, 43, 44, 45, 60, 61]);
    const start = [es.slice(0, 4), es.slice(4)];
    for (const p of [POOMSAE, KYORUGI]) {
      const stats = newStats();
      const out = localSearch(start, p, 'tier3', stats);
      const weightRange = (pool: readonly PoolEntry[]) => {
        const w = pool.map((e) => e.weightG as number);
        return Math.max(...w) - Math.min(...w);
      };
      expect(out.reduce((s, pool) => s + weightRange(pool), 0)).toBeLessThanOrEqual(
        start.reduce((s, pool) => s + weightRange(pool), 0),
      );
      expect(
        out
          .flat()
          .map((x) => x.id)
          .sort(),
      ).toEqual(es.map((x) => x.id).sort());
    }
    const stats = newStats();
    localSearch(start, POOMSAE, 'tier3', stats);
    expect(stats.rejected.TIER_REGRESSION).toBeGreaterThan(0);
  });

  it('is only a tie-break: a candidate with a lower Tier 2 always beats a lower spread', () => {
    const mk = (strategy: PoolingCandidate['strategy'], cost: [number, number, number], spread: number) =>
      ({
        strategy,
        pools: [],
        cost,
        dpCost: cost,
        tier1PhaseCost: cost,
        spread,
        search: {} as never,
      }) as PoolingCandidate;
    const ranked = rankCandidates([
      mk('WEIGHT_FIRST', [0, 0, 20_000], 8),
      mk('HEIGHT_FIRST', [0, 0, 10_000], 40),
      mk('BELT_FIRST', [0, 0, 10_000], 30),
    ]);
    expect(ranked.map((r) => r.strategy)).toEqual(['BELT_FIRST', 'HEIGHT_FIRST', 'WEIGHT_FIRST']);
  });

  it('equal on Tier 0/1/2 and spread: strategy order decides, as before', () => {
    const mk = (strategy: PoolingCandidate['strategy']) =>
      ({
        strategy,
        pools: [],
        cost: [0, 0, 0],
        dpCost: [0, 0, 0],
        tier1PhaseCost: [0, 0, 0],
        spread: 8,
        search: {} as never,
      }) as PoolingCandidate;
    expect(rankCandidates([mk('BALANCED'), mk('WEIGHT_FIRST')]).map((r) => r.strategy)).toEqual([
      'WEIGHT_FIRST',
      'BALANCED',
    ]);
  });
});
