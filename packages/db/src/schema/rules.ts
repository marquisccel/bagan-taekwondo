import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, provenance, tstz } from './columns.js';
import {
  agePolicyEnum,
  bandPurposeEnum,
  beltPolicyEnum,
  byePolicyEnum,
  contingentKeyEnum,
  disciplineEnum,
  drawFormatEnum,
  entryFormatEnum,
  genderEnum,
  genderModeEnum,
  measurementSourceEnum,
  partitionDimensionEnum,
  playUpPolicyEnum,
  ruleSetStatusEnum,
  singletonPolicyEnum,
  streamEnum,
  tableCompletenessEnum,
  toleranceDimensionEnum,
  toleranceMaxStatusEnum,
} from './enums.js';
import { appUser, tournament } from './identity.js';

/**
 * A versioned rule set (ADR-0007). Child tables are editable while DRAFT. On activation the
 * canonical snapshot and its fingerprint are frozen; every draw run also copies the snapshot
 * it used, so later edits can never change history.
 */
export const ruleSet = pgTable(
  'rule_set',
  {
    id: id(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournament.id),
    code: text('code').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    status: ruleSetStatusEnum('status').notNull().default('DRAFT'),
    agePolicy: agePolicyEnum('age_policy').notNull(),
    ageReferenceYear: integer('age_reference_year'),
    ageCutoffDate: text('age_cutoff_date'),
    ageProvenance: provenance('age_provenance').notNull(),
    plausibility: jsonb('plausibility').notNull(),
    sourceVocabulary: jsonb('source_vocabulary').notNull(),
    snapshot: jsonb('snapshot'),
    fingerprint: text('fingerprint'),
    createdBy: uuid('created_by').references(() => appUser.id),
    createdAt: createdAt(),
    activatedAt: tstz('activated_at'),
  },
  (t) => [
    unique('rule_set_version_uq').on(t.tournamentId, t.version),
    uniqueIndex('rule_set_one_active_uq')
      .on(t.tournamentId)
      .where(sql`${t.status} = 'ACTIVE'`),
    check('rule_set_version_ck', sql`${t.version} >= 1`),
    check(
      'rule_set_active_frozen_ck',
      sql`${t.status} = 'DRAFT' or (${t.snapshot} is not null and ${t.fingerprint} is not null and ${t.activatedAt} is not null)`,
    ),
    check(
      'rule_set_fingerprint_ck',
      sql`${t.fingerprint} is null or ${t.fingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
  ],
);

const ruleSetRef = () =>
  uuid('rule_set_id')
    .notNull()
    .references(() => ruleSet.id, { onDelete: 'cascade' });

export const ruleAgeDivision = pgTable(
  'rule_age_division',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    streams: streamEnum('streams').array().notNull(),
    minBirthYear: integer('min_birth_year').notNull(),
    maxBirthYear: integer('max_birth_year').notNull(),
    ord: smallint('ord').notNull(),
    playUpPolicy: playUpPolicyEnum('play_up_policy').notNull(),
    provenance: provenance('provenance').notNull(),
  },
  (t) => [
    unique('rule_age_division_code_uq').on(t.ruleSetId, t.code),
    check('rule_age_division_years_ck', sql`${t.minBirthYear} <= ${t.maxBirthYear}`),
    check('rule_age_division_streams_ck', sql`cardinality(${t.streams}) >= 1`),
  ],
);

export const ruleBelt = pgTable(
  'rule_belt',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    rank: smallint('rank').notNull(),
    label: text('label').notNull(),
    sourceLabels: text('source_labels').array().notNull(),
  },
  (t) => [
    unique('rule_belt_code_uq').on(t.ruleSetId, t.code),
    unique('rule_belt_rank_uq').on(t.ruleSetId, t.rank),
    check('rule_belt_rank_ck', sql`${t.rank} >= 1`),
  ],
);

export const ruleBeltBandScheme = pgTable(
  'rule_belt_band_scheme',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    purpose: bandPurposeEnum('purpose').notNull(),
    provenance: provenance('provenance').notNull(),
  },
  (t) => [unique('rule_belt_band_scheme_code_uq').on(t.ruleSetId, t.code)],
);

export const ruleBeltBand = pgTable(
  'rule_belt_band',
  {
    id: id(),
    schemeId: uuid('scheme_id')
      .notNull()
      .references(() => ruleBeltBandScheme.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    unique('rule_belt_band_code_uq').on(t.schemeId, t.code),
    unique('rule_belt_band_id_scheme_uq').on(t.id, t.schemeId),
  ],
);

/** A belt belongs to at most one band per scheme (unique scheme_id, belt_id). */
export const ruleBeltBandMember = pgTable(
  'rule_belt_band_member',
  {
    bandId: uuid('band_id').notNull(),
    schemeId: uuid('scheme_id').notNull(),
    beltId: uuid('belt_id')
      .notNull()
      .references(() => ruleBelt.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.bandId, t.beltId] }),
    unique('rule_belt_band_member_one_band_uq').on(t.schemeId, t.beltId),
    foreignKey({
      columns: [t.bandId, t.schemeId],
      foreignColumns: [ruleBeltBand.id, ruleBeltBand.schemeId],
    }).onDelete('cascade'),
  ],
);

export const ruleMovementMap = pgTable(
  'rule_movement_map',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    schemeId: uuid('scheme_id')
      .notNull()
      .references(() => ruleBeltBandScheme.id),
    provenance: provenance('provenance').notNull(),
  },
  (t) => [unique('rule_movement_map_code_uq').on(t.ruleSetId, t.code)],
);

export const ruleMovementMapEntry = pgTable(
  'rule_movement_map_entry',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => ruleMovementMap.id, { onDelete: 'cascade' }),
    bandId: uuid('band_id')
      .notNull()
      .references(() => ruleBeltBand.id),
    movement: text('movement').notNull(),
  },
  (t) => [primaryKey({ columns: [t.mapId, t.bandId] })],
);

export const ruleWeightClassTable = pgTable(
  'rule_weight_class_table',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    stream: streamEnum('stream').notNull(),
    ageDivisionId: uuid('age_division_id')
      .notNull()
      .references(() => ruleAgeDivision.id),
    gender: genderEnum('gender').notNull(),
    completeness: tableCompletenessEnum('completeness').notNull(),
    provenance: provenance('provenance').notNull(),
  },
  (t) => [unique('rule_weight_class_table_scope_uq').on(t.ruleSetId, t.stream, t.ageDivisionId, t.gender)],
);

export const ruleWeightClass = pgTable(
  'rule_weight_class',
  {
    id: id(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => ruleWeightClassTable.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    lowerExclusiveG: integer('lower_exclusive_g'),
    upperInclusiveG: integer('upper_inclusive_g'),
    ord: smallint('ord').notNull(),
  },
  (t) => [
    unique('rule_weight_class_code_uq').on(t.tableId, t.code),
    unique('rule_weight_class_ord_uq').on(t.tableId, t.ord),
    check('rule_weight_class_code_ck', sql`${t.code} ~ '^[-+][0-9]+$'`),
    check(
      'rule_weight_class_bounds_ck',
      sql`${t.lowerExclusiveG} is null or ${t.upperInclusiveG} is null or ${t.lowerExclusiveG} < ${t.upperInclusiveG}`,
    ),
  ],
);

export const rulePoolPolicy = pgTable(
  'rule_pool_policy',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    poolMin: smallint('pool_min').notNull(),
    poolTarget: smallint('pool_target').notNull(),
    poolMax: smallint('pool_max').notNull(),
    sizePenaltyProvenance: provenance('size_penalty_provenance').notNull(),
    beltPolicy: beltPolicyEnum('belt_policy').notNull(),
    beltSchemeId: uuid('belt_scheme_id').references(() => ruleBeltBandScheme.id),
    beltProvenance: provenance('belt_provenance').notNull(),
    tier1SlackFp: integer('tier1_slack_fp').notNull(),
    contingentWeightPermille: integer('contingent_weight_permille').notNull(),
    bracketWeightPermille: integer('bracket_weight_permille').notNull(),
    tiersProvenance: provenance('tiers_provenance').notNull(),
    singletonPolicy: singletonPolicyEnum('singleton_policy').notNull(),
    singletonProvenance: provenance('singleton_provenance').notNull(),
    measurementSource: measurementSourceEnum('measurement_source').notNull(),
    contingentKey: contingentKeyEnum('contingent_key').notNull(),
    localSearchBudgetPerEntry: integer('local_search_budget_per_entry').notNull(),
  },
  (t) => [
    unique('rule_pool_policy_code_uq').on(t.ruleSetId, t.code),
    check(
      'rule_pool_policy_sizes_ck',
      sql`1 <= ${t.poolMin} and ${t.poolMin} <= ${t.poolTarget} and ${t.poolTarget} <= ${t.poolMax}`,
    ),
    check('rule_pool_policy_hard_belt_ck', sql`${t.beltPolicy} <> 'HARD' or ${t.beltSchemeId} is not null`),
    check(
      'rule_pool_policy_weights_ck',
      sql`${t.tier1SlackFp} >= 0 and ${t.contingentWeightPermille} >= 0 and ${t.bracketWeightPermille} >= 0 and ${t.localSearchBudgetPerEntry} >= 1`,
    ),
  ],
);

export const rulePoolSizePenalty = pgTable(
  'rule_pool_size_penalty',
  {
    policyId: uuid('policy_id')
      .notNull()
      .references(() => rulePoolPolicy.id, { onDelete: 'cascade' }),
    size: smallint('size').notNull(),
    penaltyFp: integer('penalty_fp').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.policyId, t.size] }),
    check('rule_pool_size_penalty_ck', sql`${t.size} >= 1 and ${t.penaltyFp} >= 0`),
  ],
);

/**
 * Ideal vs maximum tolerance (ADR-0007). max_status UNSET is a legitimate state: simulation
 * and candidate draws run; LOCK is refused by the readiness check and by the lock command.
 */
export const ruleTolerance = pgTable(
  'rule_tolerance',
  {
    id: id(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => rulePoolPolicy.id, { onDelete: 'cascade' }),
    dimension: toleranceDimensionEnum('dimension').notNull(),
    ageDivisionId: uuid('age_division_id').references(() => ruleAgeDivision.id),
    active: boolean('active').notNull(),
    ideal: integer('ideal').notNull(),
    idealProvenance: provenance('ideal_provenance').notNull(),
    maxStatus: toleranceMaxStatusEnum('max_status').notNull().default('UNSET'),
    maxValue: integer('max_value'),
    maxProvenance: provenance('max_provenance'),
    linearWeightPermille: integer('linear_weight_permille').notNull(),
    overflowWeightPermille: integer('overflow_weight_permille').notNull(),
  },
  (t) => [
    unique('rule_tolerance_scope_uq').on(t.policyId, t.dimension, t.ageDivisionId).nullsNotDistinct(),
    check('rule_tolerance_ideal_ck', sql`${t.ideal} > 0`),
    check('rule_tolerance_max_value_ck', sql`(${t.maxStatus} = 'SET') = (${t.maxValue} is not null)`),
    check('rule_tolerance_max_ge_ideal_ck', sql`${t.maxValue} is null or ${t.maxValue} >= ${t.ideal}`),
    check('rule_tolerance_max_provenance_ck', sql`(${t.maxStatus} = 'UNSET') = (${t.maxProvenance} is null)`),
  ],
);

export const ruleCategoryTemplate = pgTable(
  'rule_category_template',
  {
    id: id(),
    ruleSetId: ruleSetRef(),
    code: text('code').notNull(),
    stream: streamEnum('stream').notNull(),
    discipline: disciplineEnum('discipline').notNull(),
    format: entryFormatEnum('format').notNull(),
    genderMode: genderModeEnum('gender_mode').notNull(),
    dimensions: partitionDimensionEnum('dimensions').array().notNull(),
    drawFormat: drawFormatEnum('draw_format').notNull(),
    poolPolicyId: uuid('pool_policy_id').references((): AnyPgColumn => rulePoolPolicy.id),
    movementMapId: uuid('movement_map_id').references(() => ruleMovementMap.id),
    byePolicy: byePolicyEnum('bye_policy'),
    bronzeMedals: smallint('bronze_medals'),
    provenance: provenance('provenance').notNull(),
  },
  (t) => [
    unique('rule_category_template_code_uq').on(t.ruleSetId, t.code),
    unique('rule_category_template_scope_uq').on(t.ruleSetId, t.stream, t.discipline, t.format),
    check(
      'rule_category_template_pool_ck',
      sql`(${t.drawFormat} = 'POOLED_SINGLE_ELIMINATION') = (${t.poolPolicyId} is not null)`,
    ),
    check(
      'rule_category_template_elimination_ck',
      sql`${t.drawFormat} = 'PERFORMANCE_ORDER' or (${t.byePolicy} is not null and coalesce(${t.bronzeMedals}, 0) in (1, 2))`,
    ),
  ],
);

export const ruleComposition = pgTable(
  'rule_composition',
  {
    ruleSetId: ruleSetRef(),
    format: entryFormatEnum('format').notNull(),
    size: smallint('size').notNull(),
    genders: genderEnum('genders').array(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleSetId, t.format] }),
    check('rule_composition_size_ck', sql`${t.size} >= 1`),
  ],
);
