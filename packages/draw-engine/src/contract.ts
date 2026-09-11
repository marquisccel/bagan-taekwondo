import type {
  CategoryGender,
  CategoryReadiness,
  Discipline,
  EligibilityStatus,
  EntryFormat,
  PoolStrategy,
  Stream,
} from '@bagantkd/domain';
import type { RuleSet, ToleranceDimension } from '@bagantkd/rules';
import type { DrawSeed, Fingerprint } from '@bagantkd/shared';

/**
 * The engine's public contract. Inputs and outputs are plain, immutable, JSON-serializable
 * data: no Dates, no class instances, integer units only (ADR-0006). The same contract is
 * used by the worker, the API (predictive validation) and the draw simulator.
 */
export const ENGINE_VERSION = '0.1.0';

export const ENGINE_STAGES = [
  'normalizeEntries',
  'validateEntries',
  'gateEligibility',
  'buildCategories',
  'buildPools',
  'optimizePools',
  'repairPools',
  'buildBracket',
  'assignByes',
  'placeSeeds',
  'optimizeBracket',
  'allocateMatchCodes',
  'calculateQuality',
  'generateExplanation',
] as const;
export type EngineStage = (typeof ENGINE_STAGES)[number];
export type StageStatus = 'IMPLEMENTED' | 'NOT_IMPLEMENTED';

/** Purpose of a run. CANDIDATE runs may become revisions; SIMULATION runs never do. */
export type EnginePurpose = 'SIMULATION' | 'CANDIDATE';

export interface EngineEntryMember {
  readonly athleteId: string;
  readonly gender: 'MALE' | 'FEMALE';
  readonly birthYear: number;
  readonly beltCode: string | null;
  readonly heightMm: number | null;
  readonly weightG: number | null;
}

/** One competition entry after import, normalization and eligibility gating (Phase 2 output). */
export interface EngineEntry {
  readonly entryId: string;
  /** Registration-system identifier printed on brackets (id_athlete in 2026). */
  readonly externalRef: string;
  readonly contingentKey: string;
  readonly stream: Stream;
  readonly discipline: Discipline;
  readonly format: EntryFormat;
  readonly ageDivisionCode: string;
  readonly categoryGender: CategoryGender;
  readonly weightClassCode: string | null;
  readonly seedNo: number | null;
  readonly eligibility: EligibilityStatus;
  readonly members: readonly EngineEntryMember[];
}

/**
 * What-if assumptions, allowed for SIMULATION only (ADR-0007). They are recorded in the run
 * manifest and never written back to a rule set.
 */
export interface SimulationAssumptions {
  readonly maxTolerances: readonly {
    readonly policyCode: string;
    readonly dimension: ToleranceDimension;
    readonly ageDivisionCode: string | null;
    readonly value: number;
  }[];
}

export interface EngineInput {
  readonly engineVersion: string;
  readonly purpose: EnginePurpose;
  readonly seed: DrawSeed;
  readonly ruleSet: RuleSet;
  readonly entries: readonly EngineEntry[];
  /** Category keys to draw; empty = every category present in `entries`. */
  readonly scope: readonly string[];
  readonly assumptions: SimulationAssumptions | null;
}

export interface Reason {
  readonly code: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PoolResult {
  readonly poolUid: string;
  readonly ordinal: number;
  readonly entryIds: readonly string[];
  readonly reasons: readonly Reason[];
}

/** Every strategy's result is kept, winning or not (ADR-0008): explainability and what-if. */
export interface StrategyCandidate {
  readonly strategy: PoolStrategy;
  readonly rank: number;
  readonly selected: boolean;
  readonly tier0Violations: number;
  readonly tier1CostFp: number;
  readonly tier2CostFp: number;
  readonly partition: readonly (readonly string[])[];
  readonly metrics: Readonly<Record<string, number>>;
}

export interface CategoryResult {
  readonly categoryKey: string;
  readonly readiness: CategoryReadiness;
  readonly blockedReasons: readonly Reason[];
  readonly candidates: readonly StrategyCandidate[];
  readonly pools: readonly PoolResult[];
}

export interface QualityFinding {
  readonly level: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: string;
  readonly subject: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EngineOutput {
  readonly engineVersion: string;
  readonly purpose: EnginePurpose;
  readonly seed: DrawSeed;
  readonly status: 'SAFE' | 'UNSAFE';
  readonly unsafeReasons: readonly Reason[];
  readonly fingerprints: {
    readonly input: Fingerprint;
    readonly rules: Fingerprint;
    readonly output: Fingerprint;
  };
  readonly stages: readonly { readonly stage: EngineStage; readonly status: StageStatus }[];
  readonly categories: readonly CategoryResult[];
  readonly quality: {
    readonly findings: readonly QualityFinding[];
    readonly metrics: Readonly<Record<string, number>>;
  };
}
