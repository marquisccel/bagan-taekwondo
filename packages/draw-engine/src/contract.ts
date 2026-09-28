import type { CategoryReadiness, PoolStrategy } from '@bagantkd/domain';
import type { SnapshotEntry, SnapshotMember } from '@bagantkd/intake';
import type { BracketSlot, Feeder, PlacementSearch } from './bracket.js';
import type { EngineLimits } from './limits.js';
import type { RuleSet, ToleranceDimension } from '@bagantkd/rules';
import type { DrawSeed, Fingerprint } from '@bagantkd/shared';

/**
 * The engine's public contract. Inputs and outputs are plain, immutable, JSON-serializable
 * data: no Dates, no class instances, integer units only (ADR-0006). The same contract is
 * used by the worker, the API (predictive validation) and the draw simulator.
 */
export const ENGINE_VERSION = '0.4.0';

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

/**
 * One competition entry exactly as frozen in an intake snapshot (Phase 2). The engine takes the
 * snapshot's shape but not its word: stages 1–4 re-verify every entry and every category key.
 */
export type EngineEntryMember = SnapshotMember;
export type EngineEntry = SnapshotEntry;

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
  /** Resource limits for this run; omitted fields use DEFAULT_ENGINE_LIMITS. */
  readonly limits?: Partial<EngineLimits>;
}

export interface Reason {
  readonly code: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface MatchResult {
  /** Logical match identity, stable for the same category, pool ordinal, round and position. */
  readonly matchUid: string;
  readonly round: number;
  readonly position: number;
  readonly feederA: Feeder;
  readonly feederB: Feeder;
  /** False for a round-1 walkover against a bye. */
  readonly real: boolean;
}

export interface BracketResult {
  readonly size: number;
  readonly rounds: number;
  readonly entries: number;
  readonly byes: number;
  readonly slots: readonly BracketSlot[];
  readonly matches: readonly MatchResult[];
  readonly placement: PlacementSearch;
}

export interface PoolResult {
  readonly poolUid: string;
  readonly ordinal: number;
  readonly entryIds: readonly string[];
  readonly isWalkover: boolean;
  /** At least one structured reason per pool (Phase 3F). */
  readonly reasons: readonly Reason[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly bracket: BracketResult;
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
  /** Tier-0 (hard) violations of this partition; a selected candidate has none. */
  readonly violations: readonly Reason[];
  /** Why this candidate ranks where it does; rejected local-search changes by reason. */
  readonly explanations: readonly Reason[];
}

export interface CategoryResult {
  readonly categoryKey: string;
  readonly templateCode: string;
  readonly readiness: CategoryReadiness;
  readonly blockedReasons: readonly Reason[];
  /** Eligible entries of the category (the set INV-03 requires placed exactly once). */
  readonly entryIds: readonly string[];
  /** Entries of the category that the gate withheld; they block readiness, never get placed. */
  readonly withheldEntryIds: readonly string[];
  readonly candidates: readonly StrategyCandidate[];
  readonly pools: readonly PoolResult[];
  /** Category-level explanation: selection, singleton suggestions, contingent structure. */
  readonly reasons: readonly Reason[];
}

export interface QualityFinding {
  readonly level: 'ERROR' | 'WARNING' | 'INFO';
  readonly code: string;
  readonly subject: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

/** An execution failure (status FAILED): a stable code, never a business-rule outcome. */
export interface EngineFailure {
  readonly code: string;
  readonly message: string;
}

/** Whether this run could become a LOCKED revision, and every reason it cannot (ADR-0007). */
export interface LockAssessment {
  readonly lockable: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly blockers: readonly Reason[];
}

export type EngineStatus = 'SAFE' | 'UNSAFE' | 'FAILED';

export interface EngineOutput {
  readonly engineVersion: string;
  readonly purpose: EnginePurpose;
  readonly seed: DrawSeed;
  readonly status: EngineStatus;
  readonly unsafeReasons: readonly Reason[];
  readonly failure: EngineFailure | null;
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
  readonly lock: LockAssessment;
  /** The limits this run enforced. */
  readonly limits: EngineLimits;
}
