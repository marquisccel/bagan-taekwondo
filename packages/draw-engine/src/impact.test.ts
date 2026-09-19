import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RuleSet } from '@bagantkd/rules';
import { describe, expect, it } from 'vitest';

import { evaluatePoolChange } from './impact.js';
import { poolCost, resolvePolicy, tier0Causes, type PoolEntry, type ResolvedPolicy } from './pooling.js';

/**
 * AUD-005: the canonical quality verdict of a MoveEntry / SwapEntries, computed with the engine's
 * own pool cost (never re-implemented in the UI or the API).
 */
const ruleSet = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../fixtures/rulesets/piala-gubernur-2026.provisional.json', import.meta.url),
    ),
    'utf-8',
  ),
) as RuleSet;
const kyorugi = (mutate?: (rs: RuleSet) => void): ResolvedPolicy => {
  const rs = structuredClone(ruleSet);
  mutate?.(rs);
  return resolvePolicy(rs, rs.poolPolicies.find((p) => p.code === 'KYORUGI_SEMI_POOL') as never, 'CADET');
};
const KYORUGI = kyorugi();

let n = 0;
const e = (o: Partial<PoolEntry> = {}): PoolEntry => ({
  id: o.id ?? `e${++n}`,
  weightG: 40_000,
  heightMm: 1500,
  beltRank: 4,
  contingent: 'A',
  ...o,
});
/** Two pools; the change moves/swaps entries between them. */
const swap = (a: PoolEntry[], b: PoolEntry[], ai: number, bi: number) => {
  const na = a.map((x, i) => (i === ai ? (b[bi] as PoolEntry) : x));
  const nb = b.map((x, i) => (i === bi ? (a[ai] as PoolEntry) : x));
  return { before: [a, b], after: [na, nb] };
};

describe('evaluatePoolChange (AUD-005)', () => {
  it('GREEN with no change when nothing physical or contingent differs (neutral swap)', () => {
    const a = [e({ contingent: 'A' }), e({ contingent: 'B' }), e({ contingent: 'C' })];
    const b = [e({ contingent: 'A' }), e({ contingent: 'B' }), e({ contingent: 'C' })];
    const { before, after } = swap(a, b, 0, 0);
    const r = evaluatePoolChange(before, after, KYORUGI);
    expect(r.level).toBe('GREEN');
    expect(r.change).toBe('UNCHANGED');
    expect(r.softViolations).toEqual([]);
    expect(r.hardViolations).toEqual([]);
  });

  it('GREEN + IMPROVED when a move tightens a pool (no-change improvement)', () => {
    const a = [e({ heightMm: 1500 }), e({ heightMm: 1500 }), e({ heightMm: 1500 }), e({ heightMm: 1700 })];
    const b = [e({ heightMm: 1700 }), e({ heightMm: 1700 })];
    const move = a[3] as PoolEntry;
    const r = evaluatePoolChange([a, b], [a.slice(0, 3), [...b, move]], KYORUGI);
    expect(r.level).toBe('GREEN');
    expect(r.change).toBe('IMPROVED');
    expect(r.after.tier1Fp).toBeLessThan(r.before.tier1Fp);
  });

  it('YELLOW HEIGHT_TOLERANCE_WORSENED when a pool leaves its 5 cm ideal', () => {
    const a = [e({ heightMm: 1500 }), e({ heightMm: 1510 }), e({ heightMm: 1520 })];
    const b = [e({ heightMm: 1800 }), e({ heightMm: 1810 }), e({ heightMm: 1820 })];
    const { before, after } = swap(a, b, 0, 0);
    const r = evaluatePoolChange(before, after, KYORUGI);
    expect(r.level).toBe('YELLOW');
    expect(r.change).toBe('WORSE');
    expect(r.softViolations).toContain('HEIGHT_TOLERANCE_WORSENED');
    expect(r.softViolations).not.toContain('WEIGHT_TOLERANCE_WORSENED');
    expect(r.hardViolations).toEqual([]);
  });

  it('YELLOW WEIGHT_TOLERANCE_WORSENED when a pool leaves its 5 kg ideal', () => {
    const a = [e({ weightG: 40_000 }), e({ weightG: 41_000 }), e({ weightG: 42_000 })];
    const b = [e({ weightG: 60_000 }), e({ weightG: 61_000 }), e({ weightG: 62_000 })];
    const { before, after } = swap(a, b, 0, 0);
    const r = evaluatePoolChange(before, after, KYORUGI);
    expect(r.level).toBe('YELLOW');
    expect(r.softViolations).toContain('WEIGHT_TOLERANCE_WORSENED');
    expect(r.softViolations).not.toContain('HEIGHT_TOLERANCE_WORSENED');
  });

  it('YELLOW BELT_TOLERANCE_WORSENED when belt ranks spread beyond the ideal', () => {
    const a = [e({ beltRank: 3 }), e({ beltRank: 3 }), e({ beltRank: 4 })];
    const b = [e({ beltRank: 8 }), e({ beltRank: 8 }), e({ beltRank: 8 })];
    const { before, after } = swap(a, b, 0, 0);
    const r = evaluatePoolChange(before, after, KYORUGI);
    expect(r.level).toBe('YELLOW');
    expect(r.softViolations).toContain('BELT_TOLERANCE_WORSENED');
  });

  it('YELLOW CONTINGENT_CONCENTRATION_WORSENED when a swap concentrates one contingent', () => {
    const a = [
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'B' }),
      e({ contingent: 'C' }),
    ];
    const b = [
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'D' }),
      e({ contingent: 'E' }),
    ];
    // swap B (pool a) with an A (pool b): pool a becomes A A A C -> concentration grows
    const { before, after } = swap(a, b, 2, 0);
    const r = evaluatePoolChange(before, after, KYORUGI);
    expect(r.softViolations).toContain('CONTINGENT_CONCENTRATION_WORSENED');
    expect(r.level).toBe('YELLOW');
    expect(r.hardViolations).toEqual([]);
  });

  it('a Tier 2 tie that concentrates a contingent is still a contingent degradation (spread breaks the tie)', () => {
    // AAAB + AAAC -> swap C for an A: AAAA + AABC has the SAME Tier 2 total but a worse spread.
    const a = [
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'B' }),
    ];
    const b = [
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'A' }),
      e({ contingent: 'C' }),
    ];
    const worse = swap(a, b, 3, 3); // B <-> C: nothing changes
    expect(evaluatePoolChange(worse.before, worse.after, KYORUGI).level).toBe('GREEN');
    const c = swap(a, b, 3, 0); // B (pool a) <-> A (pool b): a=AAAA-ish
    const r = evaluatePoolChange(c.before, c.after, KYORUGI);
    expect(r.after.tier2Fp).toBe(r.before.tier2Fp);
    expect(r.after.spread).toBeGreaterThan(r.before.spread);
    expect(r.softViolations).toEqual(['CONTINGENT_CONCENTRATION_WORSENED']);
    expect(r.change).toBe('WORSE');
  });

  it('YELLOW SINGLETON_CREATED and POOL_SIZE_WORSENED when a move leaves a walkover pool', () => {
    const a = [e(), e()];
    const b = [e(), e(), e()];
    const moved = a[1] as PoolEntry;
    const r = evaluatePoolChange([a, b], [[a[0] as PoolEntry], [...b, moved]], KYORUGI);
    expect(r.level).toBe('YELLOW');
    expect(r.softViolations).toEqual(expect.arrayContaining(['SINGLETON_CREATED', 'POOL_SIZE_WORSENED']));
  });

  it('RED POOL_SIZE_EXCEEDED when a move overfills a pool (hard rule, Tier 0)', () => {
    const a = [e(), e(), e(), e()];
    const b = [e(), e()];
    const moved = b[1] as PoolEntry;
    const r = evaluatePoolChange([a, b], [[...a, moved], [b[0] as PoolEntry]], KYORUGI);
    expect(r.level).toBe('RED');
    expect(r.hardViolations).toEqual(['POOL_SIZE_EXCEEDED']);
    expect(r.after.tier0).toBeGreaterThan(r.before.tier0);
  });

  it('RED MAX_TOLERANCE_EXCEEDED only when a committee-SET maximum is newly exceeded', () => {
    const strict = kyorugi((rs) => {
      const t = rs.poolPolicies
        .find((p) => p.code === 'KYORUGI_SEMI_POOL')
        ?.tolerances.find((x) => x.dimension === 'HEIGHT');
      if (t)
        t.max = {
          status: 'SET',
          value: 100,
          provenance: { source: 'COMMITTEE' },
        } as never;
    });
    const a = [e({ heightMm: 1500 }), e({ heightMm: 1510 })];
    const b = [e({ heightMm: 1700 }), e({ heightMm: 1710 })];
    const { before, after } = swap(a, b, 0, 0);
    const r = evaluatePoolChange(before, after, strict);
    expect(r.level).toBe('RED');
    expect(r.hardViolations).toContain('MAX_TOLERANCE_EXCEEDED');
    // With the maximum UNSET the very same change is only a soft degradation.
    expect(evaluatePoolChange(before, after, KYORUGI).level).toBe('YELLOW');
  });

  it('RED MEASURE_MISSING is raised only for a newly missing value, not one that merely moved', () => {
    const noWeight = e({ weightG: null });
    const a = [noWeight, e()];
    const b = [e(), e()];
    const moved = evaluatePoolChange([a, b], [[a[1] as PoolEntry], [...b, noWeight]], KYORUGI);
    expect(moved.hardViolations).toEqual([]);
    const c = [e(), e()];
    const fresh = evaluatePoolChange([c], [[...c, e({ heightMm: null })]], KYORUGI);
    expect(fresh.level).toBe('RED');
    expect(fresh.hardViolations).toContain('MEASURE_MISSING');
  });

  it('tier0Causes agrees with poolCost.tier0 on arbitrary pools', () => {
    const samples: PoolEntry[][] = [
      [e(), e(), e(), e(), e()],
      [e({ weightG: null }), e({ heightMm: null }), e()],
      [e({ beltRank: null }), e()],
      [],
    ];
    for (const s of samples) expect(tier0Causes(s, KYORUGI).length).toBe(poolCost(s, KYORUGI).tier0);
  });

  it('is deterministic and pure', () => {
    const a = [e({ heightMm: 1500 }), e({ heightMm: 1510 }), e({ heightMm: 1520 })];
    const b = [e({ heightMm: 1800 }), e({ heightMm: 1810 }), e({ heightMm: 1820 })];
    const { before, after } = swap(a, b, 0, 0);
    expect(evaluatePoolChange(before, after, KYORUGI)).toEqual(evaluatePoolChange(before, after, KYORUGI));
  });
});
