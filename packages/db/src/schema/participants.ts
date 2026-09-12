import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
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

import { bytea, createdAt, id, tstz } from './columns.js';
import { category } from './draw.js';
import {
  confidenceLevelEnum,
  correctableFieldEnum,
  disciplineEnum,
  eligibilityStatusEnum,
  entryFormatEnum,
  entryGroupSourceEnum,
  entryGroupStatusEnum,
  genderEnum,
  importBatchStatusEnum,
  issueSeverityEnum,
  issueStatusEnum,
  provenanceSourceEnum,
  registrationStatusEnum,
  streamEnum,
  subjectTypeEnum,
} from './enums.js';
import { appUser, tournament } from './identity.js';
import { ruleSet } from './rules.js';

const tournamentRef = () =>
  uuid('tournament_id')
    .notNull()
    .references(() => tournament.id);

export const contingentGroup = pgTable(
  'contingent_group',
  { id: id(), tournamentId: tournamentRef(), name: text('name').notNull() },
  (t) => [unique('contingent_group_name_uq').on(t.tournamentId, t.name)],
);

export const contingent = pgTable(
  'contingent',
  {
    id: id(),
    tournamentId: tournamentRef(),
    name: text('name').notNull(),
    groupId: uuid('group_id').references(() => contingentGroup.id),
  },
  (t) => [
    unique('contingent_name_uq').on(t.tournamentId, t.name),
    unique('contingent_id_tournament_uq').on(t.id, t.tournamentId),
  ],
);

// ---------------------------------------------------------------------------------------
// Import provenance
// ---------------------------------------------------------------------------------------

export const importBatch = pgTable(
  'import_batch',
  {
    id: id(),
    tournamentId: tournamentRef(),
    ruleSetId: uuid('rule_set_id').references(() => ruleSet.id),
    sourceFilename: text('source_filename').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    rowCount: integer('row_count').notNull(),
    columnMapping: jsonb('column_mapping').notNull(),
    status: importBatchStatusEnum('status').notNull().default('UPLOADED'),
    /** Source adapter that parsed the file (e.g. kolektif-2026). */
    adapter: text('adapter'),
    /** Fingerprint of every raw row in order; fixed at COMMITTED (trigger import_batch_guard). */
    contentFingerprint: text('content_fingerprint'),
    committedAt: tstz('committed_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('import_batch_id_tournament_uq').on(t.id, t.tournamentId),
    check('import_batch_sha_ck', sql`${t.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check('import_batch_rows_ck', sql`${t.rowCount} >= 0`),
    check(
      'import_batch_content_fingerprint_ck',
      sql`${t.contentFingerprint} is null or ${t.contentFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      'import_batch_committed_ck',
      sql`(${t.status} = 'COMMITTED') = (${t.committedAt} is not null) and (${t.status} <> 'COMMITTED' or (${t.contentFingerprint} is not null and ${t.adapter} is not null))`,
    ),
  ],
);

/**
 * Raw rows are stored exactly as received and are immutable (trigger import_row_raw_immutable);
 * `normalized` (the full RAW → NORMALIZED trace) is written once (trigger import_row_guard).
 */
export const importRow = pgTable(
  'import_row',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatch.id),
    rowNumber: integer('row_number').notNull(),
    /** Stable reference of the row within the batch (source id, or ROWNUM:n / id@n). */
    sourceRef: text('source_ref').notNull(),
    raw: jsonb('raw').notNull(),
    normalized: jsonb('normalized'),
  },
  (t) => [
    unique('import_row_number_uq').on(t.batchId, t.rowNumber),
    unique('import_row_source_ref_uq').on(t.batchId, t.sourceRef),
    check('import_row_number_ck', sql`${t.rowNumber} >= 1`),
  ],
);

// ---------------------------------------------------------------------------------------
// Athletes, measurements, corrections
// ---------------------------------------------------------------------------------------

/**
 * A person within one tournament (ADR-0014). Registered values are immutable once written
 * (trigger athlete_registered_immutable); corrections and weigh-ins are separate records, so
 * the original registration is always recoverable.
 */
export const athlete = pgTable(
  'athlete',
  {
    id: id(),
    tournamentId: tournamentRef(),
    nikCiphertext: bytea('nik_ciphertext'),
    nikBlindIndex: text('nik_blind_index'),
    nikFormatValid: boolean('nik_format_valid'),
    /** Pseudonymous person reference from intake (never derived from NIK or name). */
    personRef: text('person_ref'),
    /** Null when the registered value is missing or invalid; a validation_issue explains it. */
    fullName: text('full_name'),
    gender: genderEnum('gender'),
    birthDate: date('birth_date'),
    registeredHeightMm: integer('registered_height_mm'),
    registeredWeightG: integer('registered_weight_g'),
    registeredBeltCode: text('registered_belt_code'),
    sourceImportRowId: uuid('source_import_row_id').references(() => importRow.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('athlete_id_tournament_uq').on(t.id, t.tournamentId),
    uniqueIndex('athlete_person_ref_uq')
      .on(t.tournamentId, t.personRef)
      .where(sql`${t.personRef} is not null`),
    uniqueIndex('athlete_nik_blind_index_uq')
      .on(t.tournamentId, t.nikBlindIndex)
      .where(sql`${t.nikBlindIndex} is not null`),
    check('athlete_height_ck', sql`${t.registeredHeightMm} is null or ${t.registeredHeightMm} >= 0`),
    check('athlete_weight_ck', sql`${t.registeredWeightG} is null or ${t.registeredWeightG} >= 0`),
  ],
);

export const weighInRecord = pgTable(
  'weigh_in_record',
  {
    id: id(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id),
    verifiedHeightMm: integer('verified_height_mm'),
    verifiedWeightG: integer('verified_weight_g'),
    verifiedAt: tstz('verified_at').notNull(),
    verifiedBy: uuid('verified_by')
      .notNull()
      .references(() => appUser.id),
    note: text('note'),
  },
  (t) => [
    check(
      'weigh_in_some_value_ck',
      sql`${t.verifiedHeightMm} is not null or ${t.verifiedWeightG} is not null`,
    ),
    check(
      'weigh_in_positive_ck',
      sql`coalesce(${t.verifiedHeightMm}, 1) > 0 and coalesce(${t.verifiedWeightG}, 1) > 0`,
    ),
  ],
);

/** Append-only record of every correction: original and corrected value, who, why. */
export const measurementCorrection = pgTable(
  'measurement_correction',
  {
    id: id(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athlete.id),
    field: correctableFieldEnum('field').notNull(),
    originalValue: text('original_value'),
    correctedValue: text('corrected_value').notNull(),
    reason: text('reason').notNull(),
    validationIssueId: uuid('validation_issue_id').references((): AnyPgColumn => validationIssue.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [check('measurement_correction_reason_ck', sql`char_length(btrim(${t.reason})) >= 15`)],
);

// ---------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------

export const entry = pgTable(
  'entry',
  {
    id: id(),
    tournamentId: tournamentRef(),
    contingentId: uuid('contingent_id').notNull(),
    externalRef: text('external_ref'),
    importRowId: uuid('import_row_id').references(() => importRow.id),
    declaredStream: streamEnum('declared_stream').notNull(),
    declaredDiscipline: disciplineEnum('declared_discipline').notNull(),
    declaredFormat: entryFormatEnum('declared_format').notNull(),
    declaredAgeDivision: text('declared_age_division').notNull(),
    declaredClass: text('declared_class'),
    categoryId: uuid('category_id').references((): AnyPgColumn => category.id),
    registrationStatus: registrationStatusEnum('registration_status').notNull().default('REGISTERED'),
    eligibilityStatus: eligibilityStatusEnum('eligibility_status').notNull().default('BLOCKED'),
    eligibilityReasons: jsonb('eligibility_reasons')
      .notNull()
      .default(sql`'[]'::jsonb`),
    seedNo: smallint('seed_no'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('entry_id_tournament_uq').on(t.id, t.tournamentId),
    uniqueIndex('entry_external_ref_uq')
      .on(t.tournamentId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    foreignKey({
      columns: [t.contingentId, t.tournamentId],
      foreignColumns: [contingent.id, contingent.tournamentId],
    }),
    check('entry_seed_ck', sql`${t.seedNo} is null or ${t.seedNo} >= 1`),
    check(
      'entry_terminal_not_placeable_ck',
      sql`${t.registrationStatus} not in ('WITHDRAWN', 'DQ', 'NO_SHOW') or ${t.eligibilityStatus} = 'BLOCKED'`,
    ),
    index('entry_tournament_eligibility_ix').on(t.tournamentId, t.eligibilityStatus),
  ],
);

/** Members of an entry must belong to the same tournament as the entry (composite FKs). */
export const entryMember = pgTable(
  'entry_member',
  {
    entryId: uuid('entry_id').notNull(),
    athleteId: uuid('athlete_id').notNull(),
    tournamentId: uuid('tournament_id').notNull(),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.position] }),
    unique('entry_member_athlete_uq').on(t.entryId, t.athleteId),
    foreignKey({
      columns: [t.entryId, t.tournamentId],
      foreignColumns: [entry.id, entry.tournamentId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.athleteId, t.tournamentId],
      foreignColumns: [athlete.id, athlete.tournamentId],
    }),
    check('entry_member_position_ck', sql`${t.position} >= 1`),
  ],
);

/** How a pair/team entry was grouped (ADR-0010). A heuristic group needs a confirming person. */
export const entryGroup = pgTable(
  'entry_group',
  {
    entryId: uuid('entry_id')
      .primaryKey()
      .references(() => entry.id, { onDelete: 'cascade' }),
    source: entryGroupSourceEnum('source').notNull(),
    status: entryGroupStatusEnum('status').notNull(),
    confidence: confidenceLevelEnum('confidence').notNull(),
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),
    confirmedBy: uuid('confirmed_by').references(() => appUser.id),
    confirmedAt: tstz('confirmed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'entry_group_confirmation_ck',
      sql`${t.status} <> 'CONFIRMED' or ${t.source} in ('EXPLICIT', 'IMPORTED') or ${t.confirmedBy} is not null`,
    ),
    check('entry_group_confirmed_pair_ck', sql`(${t.confirmedBy} is null) = (${t.confirmedAt} is null)`),
    check(
      'entry_group_heuristic_start_ck',
      sql`${t.source} <> 'HEURISTIC' or ${t.status} <> 'CONFIRMED' or ${t.confirmedBy} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------------------

export const validationIssue = pgTable(
  'validation_issue',
  {
    id: id(),
    tournamentId: tournamentRef(),
    ruleSetId: uuid('rule_set_id').references(() => ruleSet.id),
    batchId: uuid('batch_id').references(() => importBatch.id),
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    code: text('code').notNull(),
    severity: issueSeverityEnum('severity').notNull(),
    field: text('field'),
    /** Sub-classification, e.g. NIK_BIRTHDATE_MISMATCH → YEAR | DAY_MONTH. */
    component: text('component'),
    rawValue: text('raw_value'),
    suggestedValue: text('suggested_value'),
    /** Proposed correction alternatives; never applied automatically. */
    suggestion: jsonb('suggestion'),
    /** Rule that raised the issue and who decided that rule (instruction 8). */
    ruleCode: text('rule_code'),
    ruleProvenance: provenanceSourceEnum('rule_provenance'),
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: issueStatusEnum('status').notNull().default('OPEN'),
    createdAt: createdAt(),
    resolvedAt: tstz('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => appUser.id),
    resolutionNote: text('resolution_note'),
  },
  (t) => [
    index('validation_issue_open_ix').on(t.tournamentId, t.status, t.severity),
    index('validation_issue_subject_ix').on(t.subjectType, t.subjectId),
    check('validation_issue_resolution_ck', sql`(${t.status} = 'OPEN') = (${t.resolvedAt} is null)`),
    check('validation_issue_rule_ck', sql`(${t.ruleCode} is null) = (${t.ruleProvenance} is null)`),
    check(
      'validation_issue_override_only_errors_ck',
      sql`${t.status} <> 'OVERRIDDEN' or ${t.severity} = 'ERROR'`,
    ),
    check(
      'validation_issue_ack_only_non_errors_ck',
      sql`${t.status} <> 'ACKNOWLEDGED' or ${t.severity} <> 'ERROR'`,
    ),
  ],
);

/**
 * Explicit Technical Delegate override of a data-quality ERROR (ADR-0011). The trigger
 * data_quality_override_guard verifies the actor's role in the issue's tournament; at most
 * one active (non-revoked) override exists per issue.
 */
export const dataQualityOverride = pgTable(
  'data_quality_override',
  {
    id: id(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => validationIssue.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => appUser.id),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
    revokedAt: tstz('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => appUser.id),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    uniqueIndex('data_quality_override_active_uq')
      .on(t.issueId)
      .where(sql`${t.revokedAt} is null`),
    check('data_quality_override_reason_ck', sql`char_length(btrim(${t.reason})) >= 15`),
    check(
      'data_quality_override_revocation_ck',
      sql`(${t.revokedAt} is null and ${t.revokedBy} is null and ${t.revokeReason} is null) or (${t.revokedAt} is not null and ${t.revokedBy} is not null and char_length(btrim(coalesce(${t.revokeReason}, ''))) >= 15)`,
    ),
  ],
);
