/**
 * Stable machine codes of the engine (frozen with the contract, docs/ENGINE_CONTRACT.md). A code
 * is never renamed or reused; a new situation gets a new code. Tests assert that every code the
 * engine emits is listed here. Human text is never the source of truth.
 *
 * Kinds:
 * - UNSAFE          the run cannot be used; carried in `unsafeReasons`
 * - FAILURE         an execution failure (status FAILED), not a business-rule outcome
 * - CATEGORY_BLOCKED why one category is not drawn (`blockedReasons`)
 * - LOCK_BLOCKER    why a SAFE run still cannot be locked (`lock.blockers`; rule-set findings pass through)
 * - POOL / BYE / CATEGORY / CANDIDATE   explanation reasons of a draw
 * - REJECTION       why a local-search change was rejected (`CHANGES_REJECTED.params.reason`)
 * - FINDING         quality findings (`quality.findings`)
 */
export type CodeKind =
  | 'UNSAFE'
  | 'FAILURE'
  | 'CATEGORY_BLOCKED'
  | 'LOCK_BLOCKER'
  | 'POOL'
  | 'BYE'
  | 'CATEGORY'
  | 'CANDIDATE'
  | 'REJECTION'
  | 'FINDING';

export const ENGINE_CODES = {
  UNSAFE: [
    'ENGINE_VERSION_MISMATCH',
    'ASSUMPTIONS_NOT_ALLOWED_FOR_CANDIDATE',
    'RULE_SET_INVALID',
    'SCOPE_CATEGORY_UNKNOWN',
    'ENTRY_MALFORMED',
    'INTAKE_DISAGREEMENT',
    'CATEGORY_KEY_MISMATCH',
    'CATEGORY_BLOCKED',
    'PLACEMENT_INVARIANT_VIOLATED',
    'BRACKET_INVARIANT_VIOLATED',
    'RESOURCE_LIMIT_EXCEEDED',
  ],
  FAILURE: ['ENGINE_INTERNAL_ERROR'],
  CATEGORY_BLOCKED: [
    'ENTRIES_WITHHELD',
    'NO_ELIGIBLE_ENTRIES',
    'DRAW_FORMAT_NOT_IMPLEMENTED',
    'POOL_POLICY_MISSING',
    'POOLING_REQUIRES_INDIVIDUAL_FORMAT',
    'CONTINGENT_GROUPS_UNAVAILABLE',
    'POOL_INFEASIBLE',
    'MANUAL_SEED_INVALID',
    'SINGLETON_POLICY_BLOCK',
    'RESOURCE_LIMIT_EXCEEDED',
  ],
  LOCK_BLOCKER: ['SIMULATION_RUN_NOT_LOCKABLE', 'RUN_NOT_SAFE', 'ASSUMPTIONS_PRESENT'],
  POOL: [
    'POOL_SIZE_PREFERENCE',
    'POOL_RANGE',
    'POOL_CLOSED_BY_WEIGHT_RANGE',
    'POOL_CLOSED_BY_HEIGHT_RANGE',
    'POOL_CLOSED_BY_BELT_RANGE',
    'POOL_CLOSED_BY_SIZE_LIMIT',
    'POOL_IS_WHOLE_CATEGORY',
    'CATEGORY_HAS_ONE_ENTRY',
    'SINGLETON_WALKOVER',
    'SINGLETON_NO_COMPATIBLE_PARTNER',
    'SINGLE_CONTINGENT_NO_FEASIBLE_SWAP',
    'CATEGORY_SINGLE_CONTINGENT',
    'SAME_CONTINGENT_ROUND1_UNAVOIDABLE',
    'POOL_CONTINGENT_MIX',
  ],
  BYE: ['BYE_TO_TOP_RANK', 'BYE_TO_MANUAL_SEED'],
  CATEGORY: ['CANDIDATE_SELECTED', 'MERGE_SUGGESTION', 'NO_MERGE_SUGGESTION'],
  CANDIDATE: ['CANDIDATE_RANK', 'LOCAL_SEARCH', 'CHANGES_REJECTED', 'TIER0_VIOLATION'],
  REJECTION: [
    'TIER0_VIOLATION',
    'NO_TIER1_GAIN',
    'NO_TIER2_GAIN',
    'IDEAL_REGRESSION',
    'TIER1_SLACK_EXCEEDED',
    'SINGLETON_CREATION',
    'NO_TIER3_GAIN',
    'TIER_REGRESSION',
  ],
  FINDING: [
    'ENTRY_MALFORMED',
    'INTAKE_DISAGREEMENT',
    'CATEGORY_KEY_MISMATCH',
    'CATEGORY_KEY_UNVERIFIED',
    'ENTRY_BLOCKED',
    'SINGLETON_WALKOVER',
    'SINGLE_CONTINGENT_POOL',
  ],
} as const satisfies Record<CodeKind, readonly string[]>;

export type EngineCode = (typeof ENGINE_CODES)[CodeKind][number];

export const isEngineCode = (kind: CodeKind, code: string): boolean =>
  (ENGINE_CODES[kind] as readonly string[]).includes(code);
