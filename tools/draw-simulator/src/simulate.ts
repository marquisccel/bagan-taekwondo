import { isPlaceable } from '@bagantkd/domain';
import {
  checkPlacementInvariants,
  ENGINE_VERSION,
  runDraw,
  type EngineOutput,
  type EnginePurpose,
  type InvariantViolation,
  type Reason,
  type SimulationAssumptions,
} from '@bagantkd/draw-engine';
import { buildTransformationReport, runIntake } from '@bagantkd/intake';
import { assessRuleSet, type RuleSet } from '@bagantkd/rules';
import { compareStrings, fingerprint, type DrawSeed, type Fingerprint } from '@bagantkd/shared';

import { compareToBaseline, type Baseline, type MetricComparison } from './baseline.js';
import { buildCoverage, type CoverageReport } from './coverage.js';

export const SIMULATOR_VERSION = '0.2.0';

export interface SimulationRequest {
  readonly datasetName: string;
  readonly datasetBytes: Uint8Array;
  readonly ruleSet: unknown;
  readonly engineVersion: string;
  readonly purpose: EnginePurpose;
  readonly goldenSeed: DrawSeed;
  readonly seeds: readonly DrawSeed[];
  readonly assumptions: SimulationAssumptions | null;
  readonly baseline: Baseline | null;
  /**
   * READY (default): a plan run with the golden seed finds the categories the engine can draw;
   * every seed then draws exactly that scope. ALL: every category, so blocked ones make it UNSAFE.
   */
  readonly scopeMode?: 'READY' | 'ALL';
  /** Consecutive runs of the golden seed that must produce one output fingerprint (default 2). */
  readonly replayRuns?: number;
  /** Clock for the volatile timings (never part of the report fingerprint). */
  readonly now?: () => number;
}

export interface SimulationVolatile {
  readonly planMs: number;
  readonly seedMs: Readonly<Record<string, number>>;
  readonly replayMs: number;
}

export interface SeedResult {
  readonly seed: DrawSeed;
  readonly status: EngineOutput['status'];
  readonly unsafeReasons: readonly Reason[];
  readonly fingerprints: EngineOutput['fingerprints'];
  readonly invariantViolations: readonly InvariantViolation[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface MetricSpread {
  readonly metric: string;
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

/**
 * Everything in the report body is deterministic: the same request produces the same report
 * fingerprint. Wall-clock data lives in the manifest's `volatile` block, outside the fingerprint.
 */
export interface SimulationReport {
  readonly simulatorVersion: string;
  readonly engineVersion: string;
  readonly purpose: EnginePurpose;
  readonly dataset: {
    readonly name: string;
    readonly fingerprint: Fingerprint;
    readonly rows: number;
    readonly columns: number;
  };
  readonly ruleSet: {
    readonly code: string | null;
    readonly fingerprint: Fingerprint | null;
    readonly allowedForPurpose: boolean;
    readonly lockAllowed: boolean;
    readonly lockBlockers: readonly string[];
  };
  readonly assumptions: SimulationAssumptions | null;
  /** Aggregate intake result (no personal data): what the engine was given, and what was not. */
  readonly intake: {
    readonly fatal: string | null;
    readonly snapshotFingerprint: Fingerprint | null;
    readonly persons: number;
    readonly entries: number;
    readonly entryGroups: number;
    readonly unresolvedRows: number;
    readonly categories: number;
    readonly blockedEntries: number;
    readonly excluded: number;
    readonly issueSeverityCounts: Readonly<Record<string, number>>;
  };
  /** The plan run (golden seed, every category): what can be drawn and why the rest cannot. */
  readonly plan: {
    readonly scopeMode: 'READY' | 'ALL';
    readonly categories: number;
    readonly drawn: number;
    readonly blockedByReason: Readonly<Record<string, number>>;
  };
  /** Explainability and candidate retention of the golden-seed draw (Phase 3F / 3B). */
  readonly explainability: {
    readonly pools: number;
    readonly poolsWithoutReason: number;
    readonly byes: number;
    readonly byesWithoutReason: number;
    readonly pooledCategories: number;
    readonly pooledCategoriesWithAllFiveCandidates: number;
    readonly selectedCandidatesWithTier0: number;
    readonly selectedStrategy: Readonly<Record<string, number>>;
  };
  readonly stages: EngineOutput['stages'];
  /** Stages the simulator runs before the engine: the Phase 2 intake pipeline. */
  readonly preEngine: readonly {
    readonly stage: string;
    readonly status: 'IMPLEMENTED' | 'NOT_IMPLEMENTED';
  }[];
  readonly replay: {
    readonly goldenSeed: DrawSeed;
    readonly runs: number;
    readonly identical: boolean;
    readonly outputFingerprint: Fingerprint | null;
  };
  readonly seeds: readonly SeedResult[];
  readonly robustness: readonly MetricSpread[];
  readonly baseline: {
    readonly code: string;
    readonly note: string;
    readonly comparisons: readonly MetricComparison[];
  } | null;
  /** Where every row and entry of the dataset went (golden seed); nothing is dropped silently. */
  readonly coverage: CoverageReport;
  /** Correctness verdict: safety invariants only (ACCEPTANCE_CRITERIA §2). Quality is reported separately. */
  readonly safety: {
    readonly allSeedsSafe: boolean;
    readonly invariantViolations: number;
    readonly replayIdentical: boolean;
    /** Stable codes: INTAKE_FATAL, SEED_UNSAFE, SEED_FAILED, INVARIANT_VIOLATION, DETERMINISM_CHECK_FAILED. */
    readonly reasons: readonly string[];
  };
}

export function simulate(req: SimulationRequest): {
  report: SimulationReport;
  fingerprint: Fingerprint;
  volatile: SimulationVolatile;
} {
  const now = req.now ?? (() => 0);
  const assessment = assessRuleSet(req.ruleSet, req.purpose);
  const lockAssessment = assessRuleSet(req.ruleSet, 'LOCK');
  // toEngineEntries: the Phase 2 intake pipeline; the engine receives exactly the snapshot entries.
  const intake = runIntake({ sourceName: req.datasetName, bytes: req.datasetBytes, ruleSet: req.ruleSet });
  const intakeReport = intake.fatal === null ? buildTransformationReport(intake) : null;
  const normalized = { entries: intake.snapshot?.entries ?? [] };

  const run = (seed: DrawSeed, scope: readonly string[]): EngineOutput =>
    runDraw({
      engineVersion: req.engineVersion,
      purpose: req.purpose,
      seed,
      ruleSet: (assessment.ruleSet ?? req.ruleSet) as RuleSet,
      entries: normalized.entries,
      scope,
      assumptions: req.assumptions,
    });

  const scopeMode = req.scopeMode ?? 'READY';
  let t = now();
  const plan = run(req.goldenSeed, []);
  const planMs = now() - t;
  const blockedByReason: Record<string, number> = {};
  for (const c of plan.categories)
    for (const r of c.blockedReasons) blockedByReason[r.code] = (blockedByReason[r.code] ?? 0) + 1;
  const scope =
    scopeMode === 'READY'
      ? plan.categories.filter((c) => c.readiness === 'READY').map((c) => c.categoryKey)
      : [];

  const seeds = [...new Set([req.goldenSeed, ...req.seeds])].sort((a, b) => compareStrings(a, b));
  const seedMs: Record<string, number> = {};
  const outputs = new Map<string, EngineOutput>();
  const results: SeedResult[] = seeds.map((seed) => {
    t = now();
    const out = run(seed, scope);
    seedMs[seed] = now() - t;
    outputs.set(seed, out);
    // INV-03 reference set: the engine's own verified eligible set, restricted to the intake's verdict.
    const verified = new Set(out.categories.flatMap((c) => c.entryIds));
    const eligible = normalized.entries
      .filter((e) => isPlaceable(e.eligibility) && verified.has(e.entryId))
      .map((e) => e.entryId);
    const placements = out.categories.flatMap((c) =>
      c.pools.flatMap((p) => p.entryIds.map((entryId) => ({ poolUid: p.poolUid, entryId }))),
    );
    return {
      seed,
      status: out.status,
      unsafeReasons: out.unsafeReasons,
      fingerprints: out.fingerprints,
      // Invariants are checked only when the engine produced a draw; an UNSAFE refusal places nothing.
      invariantViolations: out.status === 'SAFE' ? checkPlacementInvariants(eligible, placements) : [],
      metrics: out.quality.metrics,
    };
  });

  const replayRuns = Math.max(2, req.replayRuns ?? 2);
  t = now();
  const replayFingerprints = new Set<string>();
  for (let i = 0; i < replayRuns; i += 1)
    replayFingerprints.add(run(req.goldenSeed, scope).fingerprints.output);
  const replayMs = now() - t;
  const replayIdentical = replayFingerprints.size === 1;
  const goldenOut = outputs.get(req.goldenSeed) ?? plan;

  const metricNames = [...new Set(results.flatMap((r) => Object.keys(r.metrics)))].sort(compareStrings);
  const robustness = metricNames.map((metric) => {
    const values = results
      .map((r) => r.metrics[metric])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    return {
      metric,
      min: values[0] ?? 0,
      median: values[Math.floor((values.length - 1) / 2)] ?? 0,
      max: values[values.length - 1] ?? 0,
    };
  });

  const pools = goldenOut.categories.flatMap((c) => c.pools);
  const pooled = goldenOut.categories.filter((c) => c.candidates.length > 0);
  const selectedStrategy: Record<string, number> = {};
  for (const c of pooled)
    for (const k of c.candidates)
      if (k.selected) selectedStrategy[k.strategy] = (selectedStrategy[k.strategy] ?? 0) + 1;
  const byeSlots = pools.flatMap((p) => p.bracket.slots.filter((s) => s.entryId === null));
  const sortedRecord = (r: Record<string, number>) =>
    Object.fromEntries(Object.entries(r).sort(([a], [b]) => compareStrings(a, b)));

  const golden = results.find((r) => r.seed === req.goldenSeed);
  const report: SimulationReport = {
    simulatorVersion: SIMULATOR_VERSION,
    engineVersion: ENGINE_VERSION,
    purpose: req.purpose,
    dataset: {
      name: req.datasetName,
      fingerprint: intake.source.fingerprint,
      rows: intake.source.rows,
      columns: intake.source.columns,
    },
    ruleSet: {
      code: assessment.ruleSet?.code ?? null,
      fingerprint: assessment.fingerprint,
      allowedForPurpose: assessment.allowed,
      lockAllowed: lockAssessment.allowed,
      lockBlockers: lockAssessment.findings
        .filter((f) => f.level === 'LOCK_BLOCKER' || f.level === 'INVALID')
        .map((f) => `${f.code} ${f.path}`),
    },
    assumptions: req.assumptions,
    plan: {
      scopeMode,
      categories: plan.categories.length,
      drawn: scopeMode === 'READY' ? scope.length : plan.categories.length,
      blockedByReason: sortedRecord(blockedByReason),
    },
    explainability: {
      pools: pools.length,
      poolsWithoutReason: pools.filter((p) => p.reasons.length === 0).length,
      byes: byeSlots.length,
      byesWithoutReason: byeSlots.filter((b) => b.byeReason === null).length,
      pooledCategories: pooled.length,
      pooledCategoriesWithAllFiveCandidates: pooled.filter(
        (c) => new Set(c.candidates.map((k) => k.strategy)).size === 5,
      ).length,
      selectedCandidatesWithTier0: pooled
        .flatMap((c) => c.candidates)
        .filter((k) => k.selected && k.tier0Violations > 0).length,
      selectedStrategy: sortedRecord(selectedStrategy),
    },
    coverage: buildCoverage(intake, plan, goldenOut),
    intake: {
      fatal: intake.fatal?.code ?? null,
      snapshotFingerprint: intake.snapshotFingerprint,
      persons: intakeReport?.pipeline.persons ?? 0,
      entries: intakeReport?.pipeline.entries ?? 0,
      entryGroups: intakeReport?.pipeline.entryGroups ?? 0,
      unresolvedRows: intakeReport?.pipeline.unresolvedRows ?? 0,
      categories: intakeReport?.pipeline.categories ?? 0,
      blockedEntries: intakeReport?.blockedEntries ?? 0,
      excluded: intake.snapshot?.excluded.length ?? 0,
      issueSeverityCounts: intakeReport?.issueSeverityCounts ?? {},
    },
    stages: goldenOut.stages,
    preEngine: [
      { stage: 'parseDataset', status: 'IMPLEMENTED' },
      { stage: 'toEngineEntries', status: 'IMPLEMENTED' },
    ],
    replay: {
      goldenSeed: req.goldenSeed,
      runs: replayRuns,
      identical: replayIdentical,
      outputFingerprint: replayIdentical ? ([...replayFingerprints][0] as Fingerprint) : null,
    },
    seeds: results,
    robustness,
    baseline: req.baseline
      ? {
          code: req.baseline.code,
          note: 'Historical quality benchmark, not a correctness criterion (ADR-0012).',
          comparisons: compareToBaseline(req.baseline, golden?.metrics ?? {}),
        }
      : null,
    safety: {
      // An unreadable dataset is never a safe draw, even though the engine had nothing to place.
      allSeedsSafe: intake.fatal === null && results.every((r) => r.status === 'SAFE'),
      invariantViolations: results.reduce((n, r) => n + r.invariantViolations.length, 0),
      replayIdentical,
      reasons: [
        ...(intake.fatal !== null ? ['INTAKE_FATAL'] : []),
        ...(results.some((r) => r.status === 'UNSAFE') ? ['SEED_UNSAFE'] : []),
        ...(results.some((r) => r.status === 'FAILED') ? ['SEED_FAILED'] : []),
        ...(results.some((r) => r.invariantViolations.length > 0) ? ['INVARIANT_VIOLATION'] : []),
        ...(replayIdentical ? [] : ['DETERMINISM_CHECK_FAILED']),
      ],
    },
  };
  return { report, fingerprint: fingerprint(report), volatile: { planMs, seedMs, replayMs } };
}
