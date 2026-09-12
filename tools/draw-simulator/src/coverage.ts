import type { EngineOutput } from '@bagantkd/draw-engine';
import type { IntakeResult } from '@bagantkd/intake';
import { compareStrings } from '@bagantkd/shared';

/**
 * Real-data coverage (aggregates only): where every registration row and every entry went, and
 * why anything is not in the draw. Nothing is dropped silently: `accounted` proves that placed +
 * not placed = all snapshot entries, and every entry that is not placed has at least one reason.
 */
export interface CoverageReport {
  readonly rows: number;
  /** Rows that could not form an entry (e.g. ambiguous pair/team groups), by reason. */
  readonly unresolvedRows: number;
  readonly entries: number;
  /** Intake entries not representable for the engine (no stream/division), by reason. */
  readonly excludedEntries: Readonly<Record<string, number>>;
  readonly snapshotEntries: number;
  readonly eligibleEntries: number;
  /** Entries the intake marked BLOCKED (withheld by the engine gate). */
  readonly withheldEntries: number;
  readonly malformedEntries: number;
  readonly categories: {
    readonly total: number;
    readonly ready: number;
    readonly blocked: number;
    readonly zeroEligible: number;
    readonly blockedByReason: Readonly<Record<string, number>>;
  };
  readonly placedEntries: number;
  readonly pools: number;
  readonly walkoverPools: number;
  readonly notPlaced: {
    readonly total: number;
    /** Entries that are not eligible themselves, by their own blocking reasons (an entry may have several). */
    readonly entryNotEligibleByReason: Readonly<Record<string, number>>;
    readonly entryNotEligible: number;
    /** Eligible entries whose category is not drawn, by the category's blocking reason. */
    readonly categoryBlockedByReason: Readonly<Record<string, number>>;
    readonly categoryBlocked: number;
  };
  readonly everyNotPlacedEntryHasReason: boolean;
  readonly accounted: boolean;
}

const inc = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};
const sorted = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).sort(([a], [b]) => compareStrings(a, b)));

/**
 * @param plan  a full-scope run (every category, readiness and reasons)
 * @param drawn the SAFE draw actually produced (usually the READY scope)
 */
export function buildCoverage(intake: IntakeResult, plan: EngineOutput, drawn: EngineOutput): CoverageReport {
  const snapshot = intake.snapshot;
  const snapEntries = snapshot?.entries ?? [];
  const excluded: Record<string, number> = {};
  for (const x of snapshot?.excluded ?? []) for (const r of x.reasons) inc(excluded, r);

  const placed = new Set(drawn.categories.flatMap((c) => c.pools.flatMap((p) => p.entryIds)));
  const categoryOf = new Map<string, EngineOutput['categories'][number]>();
  for (const c of plan.categories) {
    for (const id of [...c.entryIds, ...c.withheldEntryIds]) categoryOf.set(id, c);
  }
  const entryReasons: Record<string, number> = {};
  const categoryReasons: Record<string, number> = {};
  let entryNotEligible = 0;
  let categoryBlocked = 0;
  let withoutReason = 0;
  for (const e of snapEntries) {
    if (placed.has(e.entryId)) continue;
    if (e.eligibility === 'BLOCKED') {
      entryNotEligible += 1;
      if (e.blockingReasons.length === 0) withoutReason += 1;
      for (const r of e.blockingReasons) inc(entryReasons, r);
      continue;
    }
    categoryBlocked += 1;
    const c = categoryOf.get(e.entryId);
    const reasons = c?.blockedReasons ?? [];
    if (reasons.length === 0) withoutReason += 1;
    for (const r of reasons) inc(categoryReasons, r.code);
  }
  const blockedByReason: Record<string, number> = {};
  for (const c of plan.categories) for (const r of c.blockedReasons) inc(blockedByReason, r.code);
  const pools = drawn.categories.flatMap((c) => c.pools);
  const notPlacedTotal = entryNotEligible + categoryBlocked;
  return {
    rows: intake.source.rows,
    unresolvedRows: intake.unresolvedRows.length,
    entries: intake.entries.length,
    excludedEntries: sorted(excluded),
    snapshotEntries: snapEntries.length,
    eligibleEntries: plan.quality.metrics['entriesEligible'] ?? 0,
    withheldEntries: plan.quality.metrics['entriesWithheld'] ?? 0,
    malformedEntries: plan.quality.metrics['entriesMalformed'] ?? 0,
    categories: {
      total: plan.categories.length,
      ready: plan.categories.filter((c) => c.readiness === 'READY').length,
      blocked: plan.categories.filter((c) => c.readiness === 'BLOCKED').length,
      zeroEligible: plan.categories.filter((c) => c.entryIds.length === 0).length,
      blockedByReason: sorted(blockedByReason),
    },
    placedEntries: placed.size,
    pools: pools.length,
    walkoverPools: pools.filter((p) => p.isWalkover).length,
    notPlaced: {
      total: notPlacedTotal,
      entryNotEligibleByReason: sorted(entryReasons),
      entryNotEligible,
      categoryBlockedByReason: sorted(categoryReasons),
      categoryBlocked,
    },
    everyNotPlacedEntryHasReason: withoutReason === 0,
    accounted: placed.size + notPlacedTotal === snapEntries.length,
  };
}
