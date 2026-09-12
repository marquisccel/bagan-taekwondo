import type { PoolEntry } from './pooling.js';

/**
 * Semi-prestasi quality metrics with the exact definitions of the committee benchmark
 * (tools/source-analysis/analyze.py): pools of size ≥ 2, ranges of registered values, Python
 * `statistics.median` and `statistics.quantiles(n=10)` (exclusive method), percentages rounded to
 * one decimal. Benchmark only (ADR-0012) — never a correctness criterion.
 */
export interface MetricPool {
  readonly discipline: 'KYORUGI' | 'POOMSAE';
  readonly members: readonly PoolEntry[];
  /** Round-1 real matches of the pool's bracket, as pairs of entry ids. */
  readonly round1Pairs: readonly (readonly [string, string])[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (part: number, whole: number) => (whole === 0 ? 0 : round1((100 * part) / whole));

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Python statistics.quantiles(data, n=10, method='exclusive')[8]. */
function p90(sorted: readonly number[]): number {
  const ld = sorted.length;
  if (ld < 2) return sorted[0] ?? 0;
  const m = ld + 1;
  let j = Math.floor((9 * m) / 10);
  j = j < 1 ? 1 : j > ld - 1 ? ld - 1 : j;
  const delta = 9 * m - j * 10;
  return ((sorted[j - 1] ?? 0) * (10 - delta) + (sorted[j] ?? 0) * delta) / 10;
}

export function semiPrestasiMetrics(
  pools: readonly MetricPool[],
  movementBandOfRank: ReadonlyMap<number, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  out['semiPrestasi.singletonPools'] = pools.filter((p) => p.members.length === 1).length;
  for (const discipline of ['KYORUGI', 'POOMSAE'] as const) {
    const prefix = `semiPrestasi.${discipline === 'KYORUGI' ? 'kyorugi' : 'poomsae'}`;
    const P = pools.filter((p) => p.discipline === discipline && p.members.length >= 2);
    const spread = (p: MetricPool, v: (e: PoolEntry) => number | null) => {
      const xs = p.members.map(v).filter((x): x is number => x !== null);
      return xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs);
    };
    const clean = P.filter((p) => p.members.every((e) => e.heightMm !== null && e.weightG !== null));
    const tb = clean.map((p) => spread(p, (e) => e.heightMm) / 10).sort((a, b) => a - b);
    const bb = clean.map((p) => spread(p, (e) => e.weightG) / 1000).sort((a, b) => a - b);
    let r1 = 0;
    let r1Same = 0;
    const contingent = new Map(P.flatMap((p) => p.members.map((e) => [e.id, e.contingent] as const)));
    for (const p of P) {
      for (const [a, b] of p.round1Pairs) {
        r1 += 1;
        if (contingent.get(a) === contingent.get(b)) r1Same += 1;
      }
    }
    Object.assign(out, {
      [`${prefix}.poolsSizeAtLeast2`]: P.length,
      [`${prefix}.poolsWithoutDirtyRows`]: clean.length,
      [`${prefix}.heightRangeMedianCm`]: round1(median(tb)),
      [`${prefix}.heightRangeP90Cm`]: round1(p90(tb)),
      [`${prefix}.heightRangeMaxCm`]: round1(tb[tb.length - 1] ?? 0),
      [`${prefix}.pctPoolsHeightWithin5cm`]: pct(tb.filter((x) => x <= 5).length, tb.length),
      [`${prefix}.pctPoolsHeightWithin10cm`]: pct(tb.filter((x) => x <= 10).length, tb.length),
      [`${prefix}.weightRangeMedianKg`]: round1(median(bb)),
      [`${prefix}.weightRangeP90Kg`]: round1(p90(bb)),
      [`${prefix}.pctPoolsWeightWithin3kg`]: pct(bb.filter((x) => x <= 3).length, bb.length),
      [`${prefix}.pctPoolsWeightWithin5kg`]: pct(bb.filter((x) => x <= 5).length, bb.length),
      [`${prefix}.poolsCrossingMovementBand`]: P.filter(
        (p) => new Set(p.members.map((e) => movementBandOfRank.get(e.beltRank ?? -1) ?? '?')).size > 1,
      ).length,
      [`${prefix}.singleContingentPools`]: P.filter(
        (p) => new Set(p.members.map((e) => e.contingent)).size === 1,
      ).length,
      [`${prefix}.round1SameContingentPct`]: pct(r1Same, r1),
    });
  }
  return out;
}
