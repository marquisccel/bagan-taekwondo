import {
  checkPlacementInvariants,
  ENGINE_VERSION,
  runDraw,
  type EngineEntry,
  type EngineOutput,
  type EnginePurpose,
  type InvariantViolation,
  type Reason,
  type SimulationAssumptions,
} from '@bagantkd/draw-engine';
import { assessRuleSet, type RuleSet } from '@bagantkd/rules';
import {
  compareStrings,
  fingerprint,
  fingerprintBytes,
  type DrawSeed,
  type Fingerprint,
} from '@bagantkd/shared';

import { compareToBaseline, type Baseline, type MetricComparison } from './baseline.js';
import { parseCsv } from './csv.js';

export const SIMULATOR_VERSION = '0.1.0';

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
  readonly stages: EngineOutput['stages'];
  /** Stages the simulator itself runs before the engine (import/normalization are Phase 2). */
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
  /** Correctness verdict: safety invariants only (ACCEPTANCE_CRITERIA §2). Quality is reported separately. */
  readonly safety: {
    readonly allSeedsSafe: boolean;
    readonly invariantViolations: number;
    readonly replayIdentical: boolean;
  };
}

/**
 * Phase 1: normalization (import rows → EngineEntry) is Phase 2 work, so the simulator hands the
 * engine no entries and records that honestly. The engine then refuses with UNSAFE reasons.
 */
function toEngineEntries(): { entries: EngineEntry[]; status: 'IMPLEMENTED' | 'NOT_IMPLEMENTED' } {
  return { entries: [], status: 'NOT_IMPLEMENTED' };
}

export function simulate(req: SimulationRequest): { report: SimulationReport; fingerprint: Fingerprint } {
  const table = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(req.datasetBytes));
  const assessment = assessRuleSet(req.ruleSet, req.purpose);
  const lockAssessment = assessRuleSet(req.ruleSet, 'LOCK');
  const normalized = toEngineEntries();

  const run = (seed: DrawSeed): EngineOutput =>
    runDraw({
      engineVersion: req.engineVersion,
      purpose: req.purpose,
      seed,
      ruleSet: (assessment.ruleSet ?? req.ruleSet) as RuleSet,
      entries: normalized.entries,
      scope: [],
      assumptions: req.assumptions,
    });

  const seeds = [...new Set([req.goldenSeed, ...req.seeds])].sort((a, b) => compareStrings(a, b));
  const results: SeedResult[] = seeds.map((seed) => {
    const out = run(seed);
    const eligible = normalized.entries.filter((e) => e.eligibility !== 'BLOCKED').map((e) => e.entryId);
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

  const replayA = run(req.goldenSeed);
  const replayB = run(req.goldenSeed);
  const replayIdentical = replayA.fingerprints.output === replayB.fingerprints.output;

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

  const golden = results.find((r) => r.seed === req.goldenSeed);
  const report: SimulationReport = {
    simulatorVersion: SIMULATOR_VERSION,
    engineVersion: ENGINE_VERSION,
    purpose: req.purpose,
    dataset: {
      name: req.datasetName,
      fingerprint: fingerprintBytes(req.datasetBytes),
      rows: table.rows.length,
      columns: table.header.length,
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
    stages: replayA.stages,
    preEngine: [
      { stage: 'parseDataset', status: 'IMPLEMENTED' },
      { stage: 'toEngineEntries', status: normalized.status },
    ],
    replay: {
      goldenSeed: req.goldenSeed,
      runs: 2,
      identical: replayIdentical,
      outputFingerprint: replayIdentical ? replayA.fingerprints.output : null,
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
      allSeedsSafe: results.every((r) => r.status === 'SAFE'),
      invariantViolations: results.reduce((n, r) => n + r.invariantViolations.length, 0),
      replayIdentical,
    },
  };
  return { report, fingerprint: fingerprint(report) };
}
