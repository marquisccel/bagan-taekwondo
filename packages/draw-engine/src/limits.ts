/**
 * Resource limits (production guards). The engine is pure and cannot read a clock, so it bounds
 * work deterministically instead of by time: sizes are checked before any work starts and every
 * local search carries a work counter. Exceeding a limit is never a hang and never a degraded draw:
 * the run is UNSAFE (or the category BLOCKED) with RESOURCE_LIMIT_EXCEEDED and the limit named.
 * A wall-clock timeout, where needed, belongs to the caller (worker), not to the pure engine.
 *
 * Defaults sit far above what the Phase 3 benchmarks need (10K rows: largest category 338 entries,
 * 2,071 pools, at most 432,584 work units in one candidate; REAL_2026: 64,018) and can be lowered
 * per call.
 */
export interface EngineLimits {
  /** Entries in one input. */
  readonly maxEntries: number;
  /** Eligible entries in one category. */
  readonly maxCategoryEntries: number;
  /** Entries in one single-elimination bracket (INV-04 is property-tested up to 512). */
  readonly maxBracketEntries: number;
  /** A pool policy's poolMax (the exact two-pool re-optimization enumerates 2^(2·poolMax − 1) splits). */
  readonly maxPoolSize: number;
  /** Pools in one run. */
  readonly maxPools: number;
  /** Pool-cost evaluations of one strategy candidate's local search. */
  readonly maxWorkPerCandidate: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  maxEntries: 50_000,
  maxCategoryEntries: 2_000,
  maxBracketEntries: 512,
  maxPoolSize: 8,
  maxPools: 20_000,
  maxWorkPerCandidate: 5_000_000,
};

export function resolveLimits(overrides: Partial<EngineLimits> | undefined): EngineLimits {
  return { ...DEFAULT_ENGINE_LIMITS, ...(overrides ?? {}) };
}
