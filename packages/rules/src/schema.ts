import {
  DISCIPLINES,
  DRAW_FORMATS,
  ENTRY_FORMATS,
  GENDERS,
  MEASUREMENT_SOURCES,
  STREAMS,
} from '@bagantkd/domain';
import { z } from 'zod';

/**
 * Rule-set snapshot model (ADR-0007, ADR-0008, ADR-0009).
 *
 * A rule set is data, not code: every tournament rule the engine applies is a value here,
 * with provenance saying who decided it. Integer units only: grams, millimetres, belt ranks,
 * fixed-point costs (FP_SCALE = 10_000) and per-mille weights.
 */

export const PROVENANCE_SOURCES = [
  'COMMITTEE', // decided by the tournament committee
  'STAKEHOLDER', // stated by the requester, pending committee confirmation
  'EVIDENCE_2026', // inferred from the 2026 registration data and printed draw
  'ENGINEERING_DEFAULT', // algorithm parameter chosen by engineering, subject to calibration
  'TBD', // not decided; blocks LOCK
] as const;

const provenance = z.object({
  source: z.enum(PROVENANCE_SOURCES),
  note: z.string().min(1).optional(),
});
export type Provenance = z.infer<typeof provenance>;

const code = z.string().regex(/^[A-Z0-9][A-Z0-9_+-]*$/, 'codes are UPPER_SNAKE (digits, +, - allowed)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const posInt = z.number().int().positive();
const nonNegInt = z.number().int().nonnegative();

export const AGE_POLICIES = ['BIRTH_YEAR', 'AGE_ON_EVENT_DATE', 'AGE_ON_CUTOFF_DATE', 'CUSTOM'] as const;
export const PLAY_UP_POLICIES = ['FORBID', 'ALLOW_WITH_WARNING', 'ALLOW_ONE_DIVISION_WITH_WARNING'] as const;
export const PARTITION_DIMENSIONS = [
  'STREAM',
  'DISCIPLINE',
  'AGE_DIVISION',
  'GENDER',
  'WEIGHT_CLASS',
  'FORMAT',
  'MOVEMENT',
] as const;
export type PartitionDimension = (typeof PARTITION_DIMENSIONS)[number];
export const TOLERANCE_DIMENSIONS = ['WEIGHT', 'HEIGHT', 'BELT'] as const;
export type ToleranceDimension = (typeof TOLERANCE_DIMENSIONS)[number];
export const BELT_POLICIES = ['HARD', 'SOFT', 'DISABLED'] as const;
export const SINGLETON_POLICIES = ['WALKOVER_WITH_SUGGESTIONS', 'BLOCK_CATEGORY'] as const;
/**
 * Readiness of a category that has withheld (blocked) entries. BLOCK_CATEGORY: the category is not
 * drawn until they are resolved or withdrawn. DRAW_ELIGIBLE_ONLY: the eligible entries are drawn
 * and the withheld ones stay out. Singletons are not this policy's concern (poolPolicies.singleton).
 */
export const WITHHELD_ENTRY_POLICIES = ['BLOCK_CATEGORY', 'DRAW_ELIGIBLE_ONLY'] as const;
export const BYE_POLICIES = ['SEED_PRIORITY', 'CONTINGENT_AWARE', 'RANDOM_SEEDED'] as const;
export const CONTINGENT_KEYS = ['EXACT', 'GROUP'] as const;

const ageDivision = z.object({
  code,
  label: z.string().min(1),
  streams: z.array(z.enum(STREAMS)).min(1),
  minBirthYear: z.number().int(),
  maxBirthYear: z.number().int(),
  /** Order used for play-up detection: a higher order is an older division. */
  order: nonNegInt,
  playUp: z.enum(PLAY_UP_POLICIES),
  provenance,
});

const belt = z.object({
  code,
  /** Higher rank = more advanced. */
  rank: posInt,
  label: z.string().min(1),
  /** Exact strings used by registration exports for this belt. */
  sourceLabels: z.array(z.string().min(1)).min(1),
});

const beltBandScheme = z.object({
  code,
  purpose: z.enum(['MOVEMENT', 'COMPATIBILITY']),
  bands: z.array(z.object({ code, label: z.string().min(1), beltCodes: z.array(code).min(1) })).min(1),
  provenance,
});

const movementMap = z.object({
  code,
  schemeCode: code,
  entries: z.array(z.object({ bandCode: code, movement: z.string().min(1) })).min(1),
  provenance,
});

const weightClass = z.object({
  code: z.string().regex(/^[-+]\d+$/, 'weight class codes are "-NN" or "+NN"'),
  /** Exclusive lower bound in grams; null = no lower bound. */
  lowerExclusiveG: nonNegInt.nullable(),
  /** Inclusive upper bound in grams; null = open class. */
  upperInclusiveG: posInt.nullable(),
});

const weightClassTable = z.object({
  stream: z.enum(STREAMS),
  ageDivisionCode: code,
  gender: z.enum(GENDERS),
  completeness: z.enum(['OFFICIAL', 'OBSERVED_SUBSET']),
  classes: z.array(weightClass).min(1),
  provenance,
});

export const toleranceMax = z.discriminatedUnion('status', [
  /** Not decided. Simulation and candidate draws allowed; LOCK refused (ADR-0007). */
  z.object({ status: z.literal('UNSET') }),
  /** Committee explicitly decided there is no hard limit for this dimension. */
  z.object({ status: z.literal('NONE'), provenance }),
  z.object({ status: z.literal('SET'), value: posInt, provenance }),
]);
export type ToleranceMax = z.infer<typeof toleranceMax>;

const tolerance = z.object({
  dimension: z.enum(TOLERANCE_DIMENSIONS),
  /** null = default for every division of the policy; a code overrides it for one division. */
  ageDivisionCode: code.nullable(),
  active: z.boolean(),
  /** Units: grams (WEIGHT), millimetres (HEIGHT), ranks (BELT). */
  ideal: posInt,
  idealProvenance: provenance,
  max: toleranceMax,
  /** Cost slope inside the ideal tolerance, per mille. */
  linearWeightPermille: nonNegInt,
  /** Quadratic penalty beyond the ideal tolerance, per mille. */
  overflowWeightPermille: nonNegInt,
});
export type Tolerance = z.infer<typeof tolerance>;

const poolPolicy = z.object({
  code,
  poolMin: posInt,
  poolTarget: posInt,
  poolMax: posInt,
  /** Fixed-point penalty per pool size, keys "1".."poolMax". */
  sizePenaltyFp: z.record(z.string().regex(/^\d+$/), nonNegInt),
  sizePenaltyProvenance: provenance,
  belt: z.object({
    policy: z.enum(BELT_POLICIES),
    schemeCode: code.nullable(),
    provenance,
  }),
  tolerances: z.array(tolerance).min(1),
  tiers: z.object({
    /** Max Tier-1 cost increase a Tier-2 improvement may cause, fixed-point (ADR-0008). */
    tier1SlackFp: nonNegInt,
    /** A Tier-2 move may never push a pool from inside to outside its ideal tolerance. */
    forbidIdealRegression: z.literal(true),
    contingentWeightPermille: nonNegInt,
    bracketWeightPermille: nonNegInt,
    provenance,
  }),
  singleton: z.object({ policy: z.enum(SINGLETON_POLICIES), provenance }),
  measurementSource: z.enum(MEASUREMENT_SOURCES),
  contingentKey: z.enum(CONTINGENT_KEYS),
  localSearchBudgetPerEntry: posInt,
});
export type PoolPolicy = z.infer<typeof poolPolicy>;

const categoryTemplate = z.object({
  code,
  stream: z.enum(STREAMS),
  discipline: z.enum(DISCIPLINES),
  format: z.enum(ENTRY_FORMATS),
  genderMode: z.enum(['BY_ENTRY', 'MIXED']),
  dimensions: z.array(z.enum(PARTITION_DIMENSIONS)).min(1),
  drawFormat: z.enum(DRAW_FORMATS),
  poolPolicyCode: code.nullable(),
  movementMapCode: code.nullable(),
  byePolicy: z.enum(BYE_POLICIES).nullable(),
  bronzeMedals: z.union([z.literal(1), z.literal(2)]).nullable(),
  provenance,
});
export type CategoryTemplate = z.infer<typeof categoryTemplate>;

const sourceVocabulary = z.object({
  klasifikasi: z.record(z.string(), z.object({ stream: z.enum(STREAMS), discipline: z.enum(DISCIPLINES) })),
  divisi: z.record(z.string(), code),
  gender: z.record(z.string(), z.enum(GENDERS)),
  format: z.record(z.string(), z.enum(ENTRY_FORMATS)),
  /** Who defined this mapping of source strings to canonical values. */
  provenance,
});

export const ruleSetSchema = z.object({
  schemaVersion: z.literal(1),
  code,
  name: z.string().min(1),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']),
  tournament: z.object({
    code,
    name: z.string().min(1),
    eventStart: isoDate,
    eventEnd: isoDate,
    timezone: z.string().min(1),
  }),
  age: z.object({
    policy: z.enum(AGE_POLICIES),
    referenceYear: z.number().int().nullable(),
    cutoffDate: isoDate.nullable(),
    provenance,
  }),
  ageDivisions: z.array(ageDivision).min(1),
  belts: z.array(belt).min(1),
  beltBandSchemes: z.array(beltBandScheme),
  movementMaps: z.array(movementMap),
  weightClassTables: z.array(weightClassTable),
  composition: z
    .array(
      z.object({
        format: z.enum(ENTRY_FORMATS),
        size: posInt,
        genders: z.array(z.enum(GENDERS)).nullable(),
      }),
    )
    .min(1),
  plausibility: z.object({
    heightMm: z.object({ min: posInt, max: posInt }),
    weightG: z.object({ min: posInt, max: posInt }),
    /** BMI × 10, integer. */
    bmiTenths: z.object({ min: posInt, max: posInt }),
    provenance,
  }),
  poolPolicies: z.array(poolPolicy),
  categoryReadiness: z.object({ withheldEntries: z.enum(WITHHELD_ENTRY_POLICIES), provenance }),
  categoryTemplates: z.array(categoryTemplate).min(1),
  sourceVocabulary,
  notes: z.array(z.string()),
});

export type RuleSet = z.infer<typeof ruleSetSchema>;
