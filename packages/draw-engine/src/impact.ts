import { poolCost, tier0Causes, type PoolEntry, type ResolvedPolicy } from './pooling.js';

/**
 * Canonical quality verdict of a post-draw pool change (MoveEntry / SwapEntries, AUD-005). It uses
 * exactly the engine's pool cost — the same Tier 0 (hard), Tier 1 (physical) and Tier 2
 * (contingent) definitions that built the draw — so the server, the audit trail and the UI can
 * never disagree about what "worse" means. Pure and deterministic; only the pools a command touched
 * are evaluated.
 */
export type ImpactLevel = 'GREEN' | 'YELLOW' | 'RED';
export type ImpactChange = 'IMPROVED' | 'UNCHANGED' | 'WORSE';

export const HARD_IMPACT_CODES = [
  'POOL_SIZE_EXCEEDED',
  'MEASURE_MISSING',
  'MAX_TOLERANCE_EXCEEDED',
  'BELT_BAND_MISMATCH',
] as const;
export const SOFT_IMPACT_CODES = [
  'WEIGHT_TOLERANCE_WORSENED',
  'HEIGHT_TOLERANCE_WORSENED',
  'BELT_TOLERANCE_WORSENED',
  'CONTINGENT_CONCENTRATION_WORSENED',
  'POOL_SIZE_WORSENED',
  'SINGLETON_CREATED',
] as const;

export interface ImpactMetrics {
  readonly tier0: number;
  readonly tier1Fp: number;
  readonly tier2Fp: number;
  /** Tier 3 contingent spread (Σ squared contingent group sizes); informational. */
  readonly spread: number;
  readonly sizePenaltyFp: number;
  readonly singletons: number;
  /** Summed range per active dimension over the evaluated pools (g, mm, belt ranks). */
  readonly ranges: Readonly<Record<string, number>>;
  /** Summed amount by which pool ranges exceed the dimension's ideal tolerance. */
  readonly excess: Readonly<Record<string, number>>;
}

export interface PoolChangeImpact {
  readonly level: ImpactLevel;
  readonly change: ImpactChange;
  readonly hardViolations: readonly string[];
  readonly softViolations: readonly string[];
  readonly before: ImpactMetrics;
  readonly after: ImpactMetrics;
}

function metricsOf(pools: readonly (readonly PoolEntry[])[], p: ResolvedPolicy): ImpactMetrics {
  let tier0 = 0;
  let tier1Fp = 0;
  let tier2Fp = 0;
  let spread = 0;
  let sizePenaltyFp = 0;
  let singletons = 0;
  const ranges: Record<string, number> = {};
  const excess: Record<string, number> = {};
  for (const d of p.dimensions) {
    ranges[d.dimension] = 0;
    excess[d.dimension] = 0;
  }
  for (const pool of pools) {
    const c = poolCost(pool, p);
    tier0 += c.tier0;
    tier1Fp += c.tier1;
    tier2Fp += c.tier2;
    spread += c.spread;
    sizePenaltyFp += p.sizePenaltyFp[pool.length] ?? 0;
    if (pool.length === 1) singletons += 1;
    p.dimensions.forEach((d, i) => {
      const range = c.ranges[i] ?? 0;
      ranges[d.dimension] = (ranges[d.dimension] ?? 0) + range;
      excess[d.dimension] = (excess[d.dimension] ?? 0) + Math.max(0, range - d.ideal);
    });
  }
  return { tier0, tier1Fp, tier2Fp, spread, sizePenaltyFp, singletons, ranges, excess };
}

function causeCounts(pools: readonly (readonly PoolEntry[])[], p: ResolvedPolicy): Map<string, number> {
  const out = new Map<string, number>();
  for (const pool of pools) for (const code of tier0Causes(pool, p)) out.set(code, (out.get(code) ?? 0) + 1);
  return out;
}

/**
 * `before` and `after` are the SAME pools (same count, same order) of one category, before and
 * after the command. RED: a hard (Tier 0) violation the change newly introduces — the command must
 * be refused. YELLOW: valid but a soft quality degradation an operator should see and justify.
 * GREEN: no meaningful degradation (the pools may even have improved).
 */
export function evaluatePoolChange(
  before: readonly (readonly PoolEntry[])[],
  after: readonly (readonly PoolEntry[])[],
  p: ResolvedPolicy,
): PoolChangeImpact {
  const b = metricsOf(before, p);
  const a = metricsOf(after, p);

  const causesBefore = causeCounts(before, p);
  const hard = [...causeCounts(after, p)]
    .filter(([code, n]) => n > (causesBefore.get(code) ?? 0))
    .map(([code]) => code)
    .sort();

  const soft: string[] = [];
  for (const d of p.dimensions) {
    if ((a.excess[d.dimension] ?? 0) > (b.excess[d.dimension] ?? 0))
      soft.push(`${d.dimension}_TOLERANCE_WORSENED`);
  }
  // Contingent concentration: Tier 2 first, then the Tier 3 spread that breaks Tier 2 ties (AUD-004).
  if (a.tier2Fp > b.tier2Fp || (a.tier2Fp === b.tier2Fp && a.spread > b.spread))
    soft.push('CONTINGENT_CONCENTRATION_WORSENED');
  if (a.sizePenaltyFp > b.sizePenaltyFp) soft.push('POOL_SIZE_WORSENED');
  if (a.singletons > b.singletons) soft.push('SINGLETON_CREATED');

  const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  const order =
    cmp(a.tier0, b.tier0) ||
    cmp(a.tier1Fp, b.tier1Fp) ||
    cmp(a.tier2Fp, b.tier2Fp) ||
    cmp(a.spread, b.spread);
  const change: ImpactChange = order < 0 ? 'IMPROVED' : order > 0 ? 'WORSE' : 'UNCHANGED';
  const level: ImpactLevel = hard.length > 0 ? 'RED' : soft.length > 0 ? 'YELLOW' : 'GREEN';
  return { level, change, hardViolations: hard, softViolations: soft, before: b, after: a };
}
