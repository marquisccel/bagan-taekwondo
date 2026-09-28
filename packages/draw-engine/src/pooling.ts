import type { PoolStrategy } from '@bagantkd/domain';
import type { PoolPolicy, RuleSet, ToleranceDimension } from '@bagantkd/rules';
import { compareNumbers, compareStrings, FP_SCALE, Prng, type DrawSeed } from '@bagantkd/shared';

/**
 * Semi-prestasi pooling (ADR-0008). Pure and deterministic: the seed only breaks ties between
 * entries with identical sort keys. Costs are integers in FP_SCALE units.
 */

export interface PoolEntry {
  readonly id: string;
  readonly weightG: number | null;
  readonly heightMm: number | null;
  readonly beltRank: number | null;
  readonly contingent: string;
}

interface Dimension {
  readonly dimension: ToleranceDimension;
  readonly field: 'weightG' | 'heightMm' | 'beltRank';
  readonly value: (e: PoolEntry) => number | null;
  readonly ideal: number;
  readonly linearPermille: number;
  readonly overflowPermille: number;
  /** A SET maximum tolerance; null when UNSET or NONE. */
  readonly max: number | null;
}

/** The pool policy resolved for one category (tolerance overrides for its age division applied). */
export interface ResolvedPolicy {
  readonly code: string;
  readonly poolMax: number;
  readonly poolTarget: number;
  readonly sizePenaltyFp: readonly number[];
  readonly dimensions: readonly Dimension[];
  readonly beltHard: { readonly bandOf: ReadonlyMap<number, string> } | null;
  readonly bracketWeightPermille: number;
  readonly contingentWeightPermille: number;
  readonly tier1SlackFp: number;
  readonly budgetPerEntry: number;
}

const FIELD = { WEIGHT: 'weightG', HEIGHT: 'heightMm', BELT: 'beltRank' } as const;

const VALUE: Readonly<Record<ToleranceDimension, (e: PoolEntry) => number | null>> = {
  WEIGHT: (e) => e.weightG,
  HEIGHT: (e) => e.heightMm,
  BELT: (e) => e.beltRank,
};

export function resolvePolicy(rs: RuleSet, policy: PoolPolicy, ageDivisionCode: string): ResolvedPolicy {
  const dimensions: Dimension[] = [];
  // The order of `tolerances` in the rule set is the priority order (used for tie-breaks and
  // the BALANCED ordering); costs come only from the configured slopes.
  for (const dim of ['WEIGHT', 'HEIGHT', 'BELT'] as const) {
    const t =
      policy.tolerances.find((x) => x.dimension === dim && x.ageDivisionCode === ageDivisionCode) ??
      policy.tolerances.find((x) => x.dimension === dim && x.ageDivisionCode === null);
    if (!t?.active) continue;
    if (dim === 'BELT' && policy.belt.policy !== 'SOFT') continue;
    dimensions.push({
      dimension: dim,
      field: FIELD[dim],
      value: VALUE[dim],
      ideal: t.ideal,
      linearPermille: t.linearWeightPermille,
      overflowPermille: t.overflowWeightPermille,
      max: t.max.status === 'SET' ? t.max.value : null,
    });
  }
  const order = policy.tolerances.map((t) => t.dimension);
  dimensions.sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension));
  let beltHard: ResolvedPolicy['beltHard'] = null;
  if (policy.belt.policy === 'HARD') {
    const scheme = rs.beltBandSchemes.find((s) => s.code === policy.belt.schemeCode);
    const rank = new Map(rs.belts.map((b) => [b.code, b.rank]));
    const bandOf = new Map<number, string>();
    for (const band of scheme?.bands ?? [])
      for (const c of band.beltCodes) bandOf.set(rank.get(c) ?? -1, band.code);
    beltHard = { bandOf };
  }
  const sizePenaltyFp = Array.from(
    { length: policy.poolMax + 1 },
    (_, k) => policy.sizePenaltyFp[String(k)] ?? 0,
  );
  return {
    code: policy.code,
    poolMax: policy.poolMax,
    poolTarget: policy.poolTarget,
    sizePenaltyFp,
    dimensions,
    beltHard,
    bracketWeightPermille: policy.tiers.bracketWeightPermille,
    contingentWeightPermille: policy.tiers.contingentWeightPermille,
    tier1SlackFp: policy.tiers.tier1SlackFp,
    budgetPerEntry: policy.localSearchBudgetPerEntry,
  };
}

// ---------------------------------------------------------------------------------------
// Pool cost
// ---------------------------------------------------------------------------------------

export interface PoolCost {
  readonly tier0: number;
  /**
   * Pool-size shape (tournament policy, 2026-09 pool-size preference): 1 for a singleton pool, else
   * 0. A pure structural fact about `members.length`, independent of any rule-set config — unlike
   * `sizePenaltyFp` (a per-tournament tunable tier1 cost), this is an engine-level priority that
   * always outranks physical tolerance (see `dpPartition`'s cost ordering).
   */
  readonly singleton: number;
  /** Same idea as `singleton`, for a 2-participant pool: 1 if `members.length === 2`, else 0. */
  readonly twoPerson: number;
  readonly tier1: number;
  readonly tier2: number;
  /** Range per active dimension, in its unit (g, mm, belt ranks). */
  readonly ranges: readonly number[];
  readonly minSameRound1: number;
  readonly contingentExcess: number;
  /**
   * Tier 3 (AUD-004): sum over contingents of (members of that contingent in this pool)². Lower is
   * more spread out. Never a hard rule; only breaks ties left by Tiers 0–2.
   */
  readonly spread: number;
  readonly members: number;
}

/** Exact floor(a / b) for non-negative safe integers (float quotient corrected by at most ±1). */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q -= 1;
  else if ((q + 1) * b <= a) q += 1;
  return q;
}

/**
 * Saturation cap of one dimension's deviation (2^40 FP units). Any deviation this large is already
 * far worse than every realistic pool; capping keeps every pool cost and every category sum an
 * exact safe integer (thousands of pools × 2^40 < 2^53).
 */
export const DEVIATION_CAP_FP = 2 ** 40;

const DEVIATION_CAP_BIG = BigInt(DEVIATION_CAP_FP);
const FP_PER_PERMILLE = FP_SCALE / 1000;

/** floor(num / den) exactly; BigInt only when the double product left the safe range. */
function exactFloor(num: number, den: number, a: number, b: number, c: number): number {
  if (Number.isSafeInteger(num)) return floorDiv(num, den);
  const q = (BigInt(a) * BigInt(b) * BigInt(c)) / BigInt(den);
  return Number(q > DEVIATION_CAP_BIG ? DEVIATION_CAP_BIG : q);
}

/** dev = min(cap, floor(FP·(a·x + b·max(0, x − 1)²))), x = range / ideal; exact integer arithmetic. */
export function deviationFp(
  range: number,
  d: Pick<Dimension, 'ideal' | 'linearPermille' | 'overflowPermille'>,
): number {
  const lin = exactFloor(
    d.linearPermille * range * FP_PER_PERMILLE,
    d.ideal,
    d.linearPermille,
    range,
    FP_PER_PERMILLE,
  );
  if (range <= d.ideal || lin >= DEVIATION_CAP_FP) return Math.min(lin, DEVIATION_CAP_FP);
  const excess = range - d.ideal;
  const over = exactFloor(
    d.overflowPermille * excess * excess * FP_PER_PERMILLE,
    d.ideal * d.ideal,
    d.overflowPermille,
    excess * excess,
    FP_PER_PERMILLE,
  );
  return Math.min(lin + over, DEVIATION_CAP_FP);
}

const nextPow2 = (n: number) => {
  let s = 2;
  while (s < n) s *= 2;
  return s;
};

/**
 * Exact minimum number of same-contingent round-1 meetings in a single-elimination bracket of the
 * pool: byes absorb the largest contingent first; each real match takes at most one of the rest
 * without a same-contingent pairing.
 */
export function minSameContingentRound1(counts: readonly number[], size: number): number {
  if (size < 2) return 0;
  const s = nextPow2(size);
  const byes = s - size;
  const realMatches = (size - byes) / 2;
  const cmax = Math.max(0, ...counts);
  const rest = Math.max(0, cmax - byes);
  return Math.max(0, rest - realMatches);
}

export function poolCost(members: readonly PoolEntry[], p: ResolvedPolicy): PoolCost {
  const k = members.length;
  let tier0 = k > p.poolMax ? 1 : 0;
  let tier1 = p.sizePenaltyFp[k] ?? 0;
  const ranges: number[] = [];
  for (const d of p.dimensions) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of members) {
      const v = m[d.field];
      if (v === null) {
        tier0 += 1;
        continue;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = k === 0 || lo === Infinity ? 0 : hi - lo;
    ranges.push(range);
    if (d.max !== null && range > d.max) tier0 += 1;
    tier1 += deviationFp(range, d);
  }
  if (p.beltHard) {
    const bands = new Set(
      members.map((m) => (m.beltRank === null ? '?' : (p.beltHard?.bandOf.get(m.beltRank) ?? '?'))),
    );
    if (bands.size > 1 || bands.has('?')) tier0 += 1;
  }
  // Largest contingent count (pools are small: a quadratic scan beats allocating a map). The sum of
  // every member's own group size equals the sum of squared group sizes (Tier 3 spread).
  let cmax = 0;
  let spread = 0;
  for (let i = 0; i < k; i += 1) {
    let c = 0;
    const ci = (members[i] as PoolEntry).contingent;
    for (let j = 0; j < k; j += 1) if ((members[j] as PoolEntry).contingent === ci) c += 1;
    if (c > cmax) cmax = c;
    spread += c;
  }
  const minSameRound1 = minSameContingentRound1([cmax], k);
  const contingentExcess = Math.max(0, cmax - Math.ceil(k / 2));
  const tier2 =
    (p.bracketWeightPermille * minSameRound1 + p.contingentWeightPermille * contingentExcess) *
    (FP_SCALE / 1000);
  return {
    tier0,
    singleton: k === 1 ? 1 : 0,
    twoPerson: k === 2 ? 1 : 0,
    tier1,
    tier2,
    ranges,
    minSameRound1,
    contingentExcess,
    spread,
    members: k,
  };
}

/**
 * The named causes behind `poolCost(...).tier0` (one entry per counted violation). Kept out of
 * `poolCost` on purpose: that function is the hot loop of the optimizer and must not allocate.
 * A test pins `tier0Causes(x).length === poolCost(x).tier0`.
 */
export function tier0Causes(members: readonly PoolEntry[], p: ResolvedPolicy): string[] {
  const out: string[] = [];
  const k = members.length;
  if (k > p.poolMax) out.push('POOL_SIZE_EXCEEDED');
  for (const d of p.dimensions) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of members) {
      const v = m[d.field];
      if (v === null) {
        out.push('MEASURE_MISSING');
        continue;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = k === 0 || lo === Infinity ? 0 : hi - lo;
    if (d.max !== null && range > d.max) out.push('MAX_TOLERANCE_EXCEEDED');
  }
  if (p.beltHard) {
    const bands = new Set(
      members.map((m) => (m.beltRank === null ? '?' : (p.beltHard?.bandOf.get(m.beltRank) ?? '?'))),
    );
    if (bands.size > 1 || bands.has('?')) out.push('BELT_BAND_MISMATCH');
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Strategies: an ordering, then an exact DP over contiguous partitions of that ordering.
// ---------------------------------------------------------------------------------------

export const STRATEGY_ORDER: readonly PoolStrategy[] = [
  'WEIGHT_FIRST',
  'HEIGHT_FIRST',
  'BELT_FIRST',
  'BALANCED',
  'CONTINGENT_AWARE',
];

type Key = (e: PoolEntry) => number;

function orderingFor(
  strategy: PoolStrategy,
  entries: readonly PoolEntry[],
  p: ResolvedPolicy,
  tie: ReadonlyMap<string, number>,
): PoolEntry[] {
  const w: Key = (e) => e.weightG ?? 0;
  const h: Key = (e) => e.heightMm ?? 0;
  const b: Key = (e) => e.beltRank ?? 0;
  // BALANCED: sum of values normalized by each active dimension's ideal (scaled to integers).
  const bal: Key = (e) =>
    p.dimensions.reduce((s, d) => s + Math.floor(((d.value(e) ?? 0) * 1000) / d.ideal), 0);
  const keys: Record<PoolStrategy, Key[]> = {
    WEIGHT_FIRST: [w, h, b],
    HEIGHT_FIRST: [h, w, b],
    BELT_FIRST: [b, w, h],
    BALANCED: [bal, w, h],
    CONTINGENT_AWARE: [bal, w, h],
  };
  const ks = keys[strategy];
  return [...entries].sort((x, y) => {
    for (const k of ks) {
      const c = compareNumbers(k(x), k(y));
      if (c !== 0) return c;
    }
    return compareNumbers(tie.get(x.id) ?? 0, tie.get(y.id) ?? 0);
  });
}

type Cost3 = readonly [number, number, number];
/**
 * [tier0, singleton, twoPerson, tier1(+tier2 when contingentInDp), tier2]. Pool-size shape
 * (singleton/twoPerson counts) sits right after tier0 and before tier1 (2026-09 pool-size
 * preference): minimizing singletons, then 2-person pools, always outranks physical
 * tolerance/contingent cost, so the DP never trades a 4+3+3 for a 4+4+2 merely because the smaller
 * pool happens to have a tighter range. Priority 5 (prefer more 4s over 3s once no 1s/2s remain) is
 * left entirely to the existing `sizePenaltyFp` tier1 cost, which already prices a 4-pool cheaper
 * than a 3-pool — no rule-set change was needed for that half of the policy.
 */
type Cost5 = readonly [number, number, number, number, number];
const lexLess = (a: Cost5, b: Cost5): boolean => {
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av < bv;
  }
  return false;
};

/** Optimal contiguous partition of `ordered` under (tier0, singleton, twoPerson, tier1[, tier2 when
 * contingentInDp]) — see `Cost5` above for why size shape is its own priority level. */
export function dpPartition(
  ordered: readonly PoolEntry[],
  p: ResolvedPolicy,
  contingentInDp: boolean,
): PoolEntry[][] {
  const n = ordered.length;
  const best: (Cost5 | null)[] = Array.from({ length: n + 1 }, () => null);
  const cut: number[] = new Array<number>(n + 1).fill(0);
  best[0] = [0, 0, 0, 0, 0];
  for (let i = 1; i <= n; i += 1) {
    for (let k = 1; k <= Math.min(p.poolMax, i); k += 1) {
      const prev = best[i - k];
      if (!prev) continue;
      const c = poolCost(ordered.slice(i - k, i), p);
      const cand: Cost5 = contingentInDp
        ? [
            prev[0] + c.tier0,
            prev[1] + c.singleton,
            prev[2] + c.twoPerson,
            prev[3] + c.tier1 + c.tier2,
            prev[4],
          ]
        : [
            prev[0] + c.tier0,
            prev[1] + c.singleton,
            prev[2] + c.twoPerson,
            prev[3] + c.tier1,
            prev[4] + c.tier2,
          ];
      const cur = best[i];
      if (!cur || lexLess(cand, cur)) {
        best[i] = cand;
        cut[i] = i - k;
      }
    }
  }
  const pools: PoolEntry[][] = [];
  for (let i = n; i > 0; i = cut[i] ?? 0) pools.unshift(ordered.slice(cut[i] ?? 0, i));
  return pools;
}

// ---------------------------------------------------------------------------------------
// Local search: move / swap / split, first improvement in a fixed scan order.
// ---------------------------------------------------------------------------------------

export type RejectionReason =
  | 'TIER0_VIOLATION'
  | 'NO_TIER1_GAIN'
  | 'NO_TIER2_GAIN'
  | 'IDEAL_REGRESSION'
  | 'TIER1_SLACK_EXCEEDED'
  | 'SINGLETON_CREATION'
  | 'NO_TIER3_GAIN'
  | 'TIER_REGRESSION'
  | 'SIZE_SHAPE_REGRESSION';

export interface SearchStats {
  evaluated: number;
  accepted: number;
  rejected: Record<RejectionReason, number>;
  budgetExhausted: boolean;
  /** Pool-cost evaluations spent (the unit of work; bounded by `workCap`). */
  work: number;
  workCap: number;
  /** The hard work cap stopped the search: the candidate is unusable (RESOURCE_LIMIT_EXCEEDED). */
  workCapHit: boolean;
}

export const newStats = (workCap = Number.MAX_SAFE_INTEGER): SearchStats => ({
  evaluated: 0,
  accepted: 0,
  rejected: {
    TIER0_VIOLATION: 0,
    NO_TIER1_GAIN: 0,
    NO_TIER2_GAIN: 0,
    IDEAL_REGRESSION: 0,
    TIER1_SLACK_EXCEEDED: 0,
    SINGLETON_CREATION: 0,
    NO_TIER3_GAIN: 0,
    TIER_REGRESSION: 0,
    SIZE_SHAPE_REGRESSION: 0,
  },
  budgetExhausted: false,
  work: 0,
  workCap,
  workCapHit: false,
});

const RAW_FIELDS = ['weightG', 'heightMm', 'beltRank'] as const;

/** max − min of one physical field over the pool's known values (0 when fewer than two are known). */
function rawRange(pool: readonly PoolEntry[], field: (typeof RAW_FIELDS)[number]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of pool) {
    const v = m[field];
    if (v === null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === Infinity ? 0 : hi - lo;
}

/** True when, for any field, the descending-sorted ranges after exceed the ones before at some rank. */
function physicallyWorse(
  before: readonly (readonly number[])[],
  after: readonly (readonly number[])[],
): boolean {
  return before.some((b, k) => {
    const o = [...b].sort((x, y) => y - x);
    const n = [...(after[k] ?? [])].sort((x, y) => y - x);
    return n.some((v, i) => v > (o[i] ?? 0));
  });
}

const within = (c: PoolCost, p: ResolvedPolicy) => c.ranges.map((r, i) => r <= (p.dimensions[i]?.ideal ?? 0));

/** Unchanged shape [tier0, tier1, tier2] — this is the stable public contract `draw.ts` reads by
 * index (`cost[0]/[1]/[2]` as `tier0Violations`/`tier1CostFp`/`tier2CostFp`, persisted per
 * candidate); the new pool-size-shape priority is tracked separately (`sumSizeShape` below), never
 * folded into this tuple's positions. */
function sumCosts(pools: readonly PoolEntry[][], p: ResolvedPolicy): Cost3 {
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (const pool of pools) {
    const c = poolCost(pool, p);
    t0 += c.tier0;
    t1 += c.tier1;
    t2 += c.tier2;
  }
  return [t0, t1, t2];
}

/** [singleton, twoPerson] counts across the whole category — the same pool-size-shape priority used
 * inside `dpPartition`, computed here for `rankCandidates` to apply across strategies too. */
function sumSizeShape(pools: readonly PoolEntry[][], p: ResolvedPolicy): readonly [number, number] {
  let single = 0;
  let two = 0;
  for (const pool of pools) {
    const c = poolCost(pool, p);
    single += c.singleton;
    two += c.twoPerson;
  }
  return [single, two];
}

/**
 * Phase "tier1": accept a change iff (tier0, tier1) decreases lexicographically (this also repairs
 * tier-0 violations). Neighbourhoods: move, swap, exact re-optimization of any two pools (which
 * includes splitting a pool and merging two), and dissolving a pool of ≤ 2 into other pools.
 *
 * Phase "tier2": move and swap only; accept iff tier2 decreases, tier0 does not increase, no
 * singleton is created, no affected pool leaves its ideal tolerance on any dimension, and total
 * tier1 stays within `tier1Base + tier1SlackFp` (the slack is a budget for the whole category).
 *
 * Phase "tier3" (AUD-004, contingent spread): move and swap only; accept iff the spread
 * (Σ squared contingent group sizes per pool) decreases while tier0, tier1 and tier2 do not
 * increase, no singleton is created and no pool leaves its ideal tolerance. It never spends slack.
 *
 * First improvement in a fixed scan order; one evaluation = one candidate change (a pair
 * re-optimization counts once). The search stops at `budgetPerEntry × n` evaluations.
 */
/** Called for every accepted change (tests use it to check the Tier-2 rules change by change). */
export type ChangeObserver = (change: {
  readonly phase: 'tier1' | 'tier2' | 'tier3';
  readonly before: readonly (PoolCost | null)[];
  readonly after: readonly (PoolCost | null)[];
  readonly tier1Total: number;
  readonly tier1Base: number;
}) => void;

export function localSearch(
  start: readonly PoolEntry[][],
  p: ResolvedPolicy,
  phase: 'tier1' | 'tier2' | 'tier3',
  stats: SearchStats,
  observer?: ChangeObserver,
): PoolEntry[][] {
  const pools = start.filter((x) => x.length > 0).map((x) => [...x]);
  const cost = pools.map((x) => poolCost(x, p));
  const n = pools.reduce((s, x) => s + x.length, 0);
  const budget = stats.evaluated + p.budgetPerEntry * n;
  const tier1Base = cost.reduce((s, c) => s + c.tier1, 0);
  let tier1Total = tier1Base;
  const overWorkCap = () => {
    if (stats.work < stats.workCap) return false;
    stats.workCapHit = true;
    return true;
  };
  const outOfBudget = () => {
    if (overWorkCap()) return true;
    if (stats.evaluated < budget) return false;
    stats.budgetExhausted = true;
    return true;
  };
  const regress = (before: PoolCost, after: PoolCost) => {
    const a = within(before, p);
    const b = within(after, p);
    return a.some((ok, k) => ok && !b[k]);
  };

  /** Index `pools.length` means a new pool. Empty `next` removes the pool. */
  const tryChanges = (changes: readonly { i: number; next: PoolEntry[] }[]): boolean => {
    stats.evaluated += 1;
    stats.work += changes.length;
    let d0 = 0;
    let d1 = 0;
    let d2 = 0;
    let d3 = 0;
    const rawBefore: number[][] = RAW_FIELDS.map(() => []);
    const rawAfter: number[][] = RAW_FIELDS.map(() => []);
    const evaluated = changes.map(({ i, next }) => {
      const old = i < pools.length ? (cost[i] as PoolCost) : null;
      const c = next.length > 0 ? poolCost(next, p) : null;
      d0 += (c?.tier0 ?? 0) - (old?.tier0 ?? 0);
      d1 += (c?.tier1 ?? 0) - (old?.tier1 ?? 0);
      d2 += (c?.tier2 ?? 0) - (old?.tier2 ?? 0);
      d3 += (c?.spread ?? 0) - (old?.spread ?? 0);
      if (phase === 'tier3') {
        RAW_FIELDS.forEach((f, k) => {
          rawBefore[k]?.push(rawRange(pools[i] ?? [], f));
          rawAfter[k]?.push(rawRange(next, f));
        });
      }
      return { i, next, old, c };
    });
    if (d0 > 0) return reject(stats, 'TIER0_VIOLATION');
    // Pool-size shape (2026-09 pool-size preference) is decided once, by the DP's initial partition
    // (see `dpPartition`'s Cost5 ordering); local search only refines composition for physical
    // tolerance/contingent reasons afterward and must never re-litigate it for a marginal gain --
    // unless the change is fixing a genuine hard-constraint violation (d0 < 0), it may not turn a
    // pool that wasn't already a singleton or a 2-person pool into one.
    if (
      d0 >= 0 &&
      evaluated.some(
        (x) => (x.next.length === 1 || x.next.length === 2) && x.next.length !== (x.old?.members ?? -1),
      )
    )
      return reject(stats, 'SIZE_SHAPE_REGRESSION');
    if (phase === 'tier1') {
      if (!(d0 < 0 || d1 < 0)) return reject(stats, 'NO_TIER1_GAIN');
    } else if (phase === 'tier3') {
      // Tie-break only (AUD-004): spread must improve while Tiers 0–2 stay exactly as good.
      if (d3 >= 0) return reject(stats, 'NO_TIER3_GAIN');
      // Neutral for the physical grouping: for weight, height and belt — also a dimension the rule
      // set switched off (e.g. Poomsae weight) — the affected pools' ranges, sorted largest first,
      // may not grow anywhere. So no pool gets wider than a pool that was already at least as wide,
      // and the number of pools beyond any tolerance can never increase.
      if (d1 > 0 || d2 > 0 || physicallyWorse(rawBefore, rawAfter)) return reject(stats, 'TIER_REGRESSION');
      if (evaluated.some((x) => x.next.length === 1 && (x.old?.members ?? 0) !== 1))
        return reject(stats, 'SINGLETON_CREATION');
      if (evaluated.some((x) => x.old !== null && x.c !== null && regress(x.old, x.c)))
        return reject(stats, 'IDEAL_REGRESSION');
    } else {
      if (d2 >= 0) return reject(stats, 'NO_TIER2_GAIN');
      // A walkover is never the price of contingent diversity: Tier 2 may not create a singleton.
      if (evaluated.some((x) => x.next.length === 1 && (x.old?.members ?? 0) !== 1))
        return reject(stats, 'SINGLETON_CREATION');
      if (evaluated.some((x) => x.old !== null && x.c !== null && regress(x.old, x.c)))
        return reject(stats, 'IDEAL_REGRESSION');
      if (tier1Total + d1 > tier1Base + p.tier1SlackFp) return reject(stats, 'TIER1_SLACK_EXCEEDED');
    }
    stats.accepted += 1;
    tier1Total += d1;
    observer?.({
      phase,
      before: evaluated.map((x) => x.old),
      after: evaluated.map((x) => x.c),
      tier1Total,
      tier1Base,
    });
    for (const x of evaluated) {
      if (x.i < pools.length) {
        pools[x.i] = x.next;
        cost[x.i] = x.c ?? poolCost([], p);
      } else {
        pools.push(x.next);
        cost.push(x.c as PoolCost);
      }
    }
    for (let i = pools.length - 1; i >= 0; i -= 1) {
      if ((pools[i]?.length ?? 0) === 0) {
        pools.splice(i, 1);
        cost.splice(i, 1);
      }
    }
    return true;
  };

  /**
   * Scans pools circularly from `from0`; returns the pool index where a change was accepted, or -1
   * after one full pass without improvement. Continuing from the last accepted position (instead of
   * restarting at pool 0) avoids re-evaluating the untouched prefix after every change.
   */
  const moveOrSwap = (from0: number): number => {
    const count = pools.length;
    for (let step = 0; step < count; step += 1) {
      const i = (from0 + step) % pools.length;
      const from = pools[i] as PoolEntry[];
      for (let a = 0; a < from.length; a += 1) {
        const moved = from[a] as PoolEntry;
        for (let j = 0; j <= pools.length; j += 1) {
          if (j === i) continue;
          const to = j < pools.length ? (pools[j] as PoolEntry[]) : [];
          const canMove = to.length < p.poolMax && !(j === pools.length && from.length === 1);
          if (canMove) {
            if (outOfBudget()) return -1;
            if (
              tryChanges([
                { i, next: from.filter((_, x) => x !== a) },
                { i: j, next: [...to, moved] },
              ])
            )
              return Math.min(i, pools.length - 1);
          }
          for (let b = 0; b < to.length; b += 1) {
            if (outOfBudget()) return -1;
            const other = to[b] as PoolEntry;
            if (
              tryChanges([
                { i, next: from.map((e, x) => (x === a ? other : e)) },
                { i: j, next: to.map((e, x) => (x === b ? moved : e)) },
              ])
            )
              return i;
          }
        }
      }
    }
    return -1;
  };

  /** Best split of the union of two pools into ≤ 2 pools (exact over 2^(|A∪B|−1) splits). */
  const pairReopt = (): boolean => {
    for (let i = 0; i < pools.length; i += 1) {
      for (let j = i + 1; j <= pools.length; j += 1) {
        const a = pools[i] as PoolEntry[];
        const b = j < pools.length ? (pools[j] as PoolEntry[]) : [];
        const u = [...a, ...b];
        if (u.length < 2) continue;
        const cur = (cost[i] as PoolCost).tier1 + (j < pools.length ? (cost[j] as PoolCost).tier1 : 0);
        const cur0 = (cost[i] as PoolCost).tier0 + (j < pools.length ? (cost[j] as PoolCost).tier0 : 0);
        let best: { x: PoolEntry[]; y: PoolEntry[]; t0: number; t1: number } | null = null;
        const rest = u.length - 1;
        for (let mask = 0; mask < 1 << rest; mask += 1) {
          if (overWorkCap()) return false;
          stats.work += 2;
          const x: PoolEntry[] = [u[0] as PoolEntry];
          const y: PoolEntry[] = [];
          for (let k = 0; k < rest; k += 1) ((mask >> k) & 1 ? x : y).push(u[k + 1] as PoolEntry);
          if (x.length > p.poolMax || y.length > p.poolMax) continue;
          const cx = poolCost(x, p);
          const cy = y.length > 0 ? poolCost(y, p) : null;
          const t0 = cx.tier0 + (cy?.tier0 ?? 0);
          const t1 = cx.tier1 + (cy?.tier1 ?? 0);
          if (!best || t0 < best.t0 || (t0 === best.t0 && t1 < best.t1)) best = { x, y, t0, t1 };
        }
        if (best && (best.t0 < cur0 || (best.t0 === cur0 && best.t1 < cur))) {
          if (outOfBudget()) return false;
          if (
            tryChanges([
              { i, next: best.x },
              { i: j, next: best.y },
            ])
          )
            return true;
        }
      }
    }
    return false;
  };

  /** Move every member of a pool of ≤ 2 into other pools at once. */
  const dissolve = (): boolean => {
    for (let i = 0; i < pools.length; i += 1) {
      const src = pools[i] as PoolEntry[];
      if (src.length > 2 || pools.length < 2) continue;
      const targets = pools.map((_, j) => j).filter((j) => j !== i);
      const tuples: number[][] =
        src.length === 1 ? targets.map((t) => [t]) : targets.flatMap((t) => targets.map((u) => [t, u]));
      for (const tuple of tuples) {
        const next = new Map<number, PoolEntry[]>();
        tuple.forEach((t, k) => next.set(t, [...(next.get(t) ?? pools[t] ?? []), src[k] as PoolEntry]));
        if ([...next.values()].some((x) => x.length > p.poolMax)) continue;
        if (outOfBudget()) return false;
        if (tryChanges([{ i, next: [] }, ...[...next].map(([t, x]) => ({ i: t, next: x }))])) return true;
      }
    }
    return false;
  };

  let cursor = 0;
  for (;;) {
    const at = moveOrSwap(cursor);
    if (at >= 0) {
      cursor = Math.max(0, at);
      continue;
    }
    if (outOfBudget()) break;
    if (phase === 'tier1' && (pairReopt() || dissolve())) continue;
    break;
  }
  return pools;
}

function reject(stats: SearchStats, reason: RejectionReason): false {
  stats.rejected[reason] += 1;
  return false;
}

// ---------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------

export interface PoolingCandidate {
  readonly strategy: PoolStrategy;
  readonly pools: readonly (readonly PoolEntry[])[];
  readonly cost: Cost3;
  readonly dpCost: Cost3;
  /** Cost after the Tier-1 local search, before Tier-2 spends slack (exhaustive comparisons use it). */
  readonly tier1PhaseCost: Cost3;
  /**
   * [singleton, twoPerson] pool counts (2026-09 pool-size preference) — outranks `cost`'s own tier1
   * in `rankCandidates`, same priority order as inside `dpPartition`. Kept as its own field rather
   * than folded into `cost` so `cost[0]/[1]/[2]` keep meaning exactly `tier0Violations`/
   * `tier1CostFp`/`tier2CostFp` for every existing reader (`draw.ts`, persisted candidate rows).
   */
  readonly sizeShape: readonly [number, number];
  /** Tier 3 contingent spread of the final pools (lower = more spread); breaks Tier 0–2 ties. */
  readonly spread: number;
  readonly search: SearchStats;
}

function sumSpread(pools: readonly PoolEntry[][], p: ResolvedPolicy): number {
  let s = 0;
  for (const pool of pools) s += poolCost(pool, p).spread;
  return s;
}

/** Canonical pool order: by the first active dimension's minimum, then the rest, then ids. */
export function canonicalPools(pools: readonly (readonly PoolEntry[])[], p: ResolvedPolicy): PoolEntry[][] {
  const memberKey = (e: PoolEntry) => p.dimensions.map((d) => d.value(e) ?? 0);
  const sortedMembers = pools.map((pool) =>
    [...pool].sort((a, b) => {
      const ka = memberKey(a);
      const kb = memberKey(b);
      for (let i = 0; i < ka.length; i += 1) {
        const c = compareNumbers(ka[i] ?? 0, kb[i] ?? 0);
        if (c !== 0) return c;
      }
      return compareStrings(a.id, b.id);
    }),
  );
  return sortedMembers.sort((x, y) => {
    const kx = x[0] ? memberKey(x[0]) : [];
    const ky = y[0] ? memberKey(y[0]) : [];
    for (let i = 0; i < kx.length; i += 1) {
      const c = compareNumbers(kx[i] ?? 0, ky[i] ?? 0);
      if (c !== 0) return c;
    }
    return compareStrings(x[0]?.id ?? '', y[0]?.id ?? '');
  });
}

export function buildCandidates(
  entries: readonly PoolEntry[],
  p: ResolvedPolicy,
  seed: DrawSeed,
  categoryKey: string,
  workCapPerCandidate = Number.MAX_SAFE_INTEGER,
): PoolingCandidate[] {
  const tie = new Map(
    Prng.fromSeed(seed, `pool-ties/${categoryKey}`)
      .shuffled(entries.map((e) => e.id))
      .map((id, i) => [id, i]),
  );
  const out: PoolingCandidate[] = [];
  for (const strategy of STRATEGY_ORDER) {
    const ordered = orderingFor(strategy, entries, p, tie);
    const dp = dpPartition(ordered, p, strategy === 'CONTINGENT_AWARE');
    const search = newStats(workCapPerCandidate);
    const afterTier1 = localSearch(dp, p, 'tier1', search);
    const afterTier2 = localSearch(afterTier1, p, 'tier2', search);
    const afterTier3 = search.workCapHit ? afterTier2 : localSearch(afterTier2, p, 'tier3', search);
    const pools = canonicalPools(afterTier3, p);
    out.push({
      strategy,
      pools,
      cost: sumCosts(pools, p),
      dpCost: sumCosts(dp, p),
      tier1PhaseCost: sumCosts(afterTier1, p),
      sizeShape: sumSizeShape(pools, p),
      spread: sumSpread(pools, p),
      search,
    });
    // A candidate stopped by the hard work cap makes the category unusable; stop spending work.
    if (search.workCapHit) break;
  }
  return out;
}

/** Lowest tier0, then pool-size shape (singleton count, then 2-person count — 2026-09 pool-size
 * preference, outranks physical cost the same way it does inside `dpPartition`), then lowest
 * (tier1, tier2), then lowest contingent spread (Tier 3); ties break by strategy order (ADR-0008). */
export function rankCandidates(cands: readonly PoolingCandidate[]): PoolingCandidate[] {
  return [...cands].sort((a, b) => {
    const tier0 = compareNumbers(a.cost[0] ?? 0, b.cost[0] ?? 0);
    if (tier0 !== 0) return tier0;
    const single = compareNumbers(a.sizeShape[0], b.sizeShape[0]);
    if (single !== 0) return single;
    const two = compareNumbers(a.sizeShape[1], b.sizeShape[1]);
    if (two !== 0) return two;
    for (let i = 1; i < 3; i += 1) {
      const c = compareNumbers(a.cost[i] ?? 0, b.cost[i] ?? 0);
      if (c !== 0) return c;
    }
    const spread = compareNumbers(a.spread, b.spread);
    if (spread !== 0) return spread;
    return STRATEGY_ORDER.indexOf(a.strategy) - STRATEGY_ORDER.indexOf(b.strategy);
  });
}
