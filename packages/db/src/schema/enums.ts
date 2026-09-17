import {
  CATEGORY_GENDERS,
  CATEGORY_READINESS,
  COMMAND_OUTCOMES,
  COMPLAINT_STATUSES,
  CONFIDENCE_LEVELS,
  CORRECTABLE_FIELDS,
  DISCIPLINES,
  DRAW_FORMATS,
  DRAW_RUN_KINDS,
  DRAW_RUN_STATUSES,
  ELIGIBILITY_STATUSES,
  ENTRY_FORMATS,
  ENTRY_GROUP_SOURCES,
  ENTRY_GROUP_STATUSES,
  EXPORT_FORMATS,
  EXPORT_MODES,
  EXPORT_SCOPE_TYPES,
  EXPORT_STATUSES,
  EXPORT_TYPES,
  GENDERS,
  IMPORT_BATCH_STATUSES,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  MATCH_STATUSES,
  MEASUREMENT_SOURCES,
  POOL_STRATEGIES,
  REGISTRATION_STATUSES,
  REVISION_LIFECYCLES,
  ROLES,
  RULE_SET_STATUSES,
  STREAMS,
  SUBJECT_TYPES,
  TOURNAMENT_STATUSES,
} from '@bagantkd/domain';
import {
  AGE_POLICIES,
  BELT_POLICIES,
  BYE_POLICIES,
  CONTINGENT_KEYS,
  PARTITION_DIMENSIONS,
  PLAY_UP_POLICIES,
  PROVENANCE_SOURCES,
  SINGLETON_POLICIES,
  TOLERANCE_DIMENSIONS,
} from '@bagantkd/rules';
import { pgEnum } from 'drizzle-orm/pg-core';

// Every database enum is generated from the domain/rules arrays: one source of truth.
export const streamEnum = pgEnum('stream', STREAMS);
export const disciplineEnum = pgEnum('discipline', DISCIPLINES);
export const entryFormatEnum = pgEnum('entry_format', ENTRY_FORMATS);
export const genderEnum = pgEnum('gender', GENDERS);
export const categoryGenderEnum = pgEnum('category_gender', CATEGORY_GENDERS);
export const registrationStatusEnum = pgEnum('registration_status', REGISTRATION_STATUSES);
export const eligibilityStatusEnum = pgEnum('eligibility_status', ELIGIBILITY_STATUSES);
export const entryGroupSourceEnum = pgEnum('entry_group_source', ENTRY_GROUP_SOURCES);
export const entryGroupStatusEnum = pgEnum('entry_group_status', ENTRY_GROUP_STATUSES);
export const confidenceLevelEnum = pgEnum('confidence_level', CONFIDENCE_LEVELS);
export const issueSeverityEnum = pgEnum('issue_severity', ISSUE_SEVERITIES);
export const issueStatusEnum = pgEnum('issue_status', ISSUE_STATUSES);
export const measurementSourceEnum = pgEnum('measurement_source', MEASUREMENT_SOURCES);
export const correctableFieldEnum = pgEnum('correctable_field', CORRECTABLE_FIELDS);
export const drawRunKindEnum = pgEnum('draw_run_kind', DRAW_RUN_KINDS);
export const drawRunStatusEnum = pgEnum('draw_run_status', DRAW_RUN_STATUSES);
export const categoryReadinessEnum = pgEnum('category_readiness', CATEGORY_READINESS);
export const revisionLifecycleEnum = pgEnum('revision_lifecycle', REVISION_LIFECYCLES);
export const poolStrategyEnum = pgEnum('pool_strategy', POOL_STRATEGIES);
export const drawFormatEnum = pgEnum('draw_format', DRAW_FORMATS);
export const matchStatusEnum = pgEnum('match_status', MATCH_STATUSES);
export const commandOutcomeEnum = pgEnum('command_outcome', COMMAND_OUTCOMES);
export const complaintStatusEnum = pgEnum('complaint_status', COMPLAINT_STATUSES);
export const roleEnum = pgEnum('role', ROLES);
export const importBatchStatusEnum = pgEnum('import_batch_status', IMPORT_BATCH_STATUSES);
export const tournamentStatusEnum = pgEnum('tournament_status', TOURNAMENT_STATUSES);
export const ruleSetStatusEnum = pgEnum('rule_set_status', RULE_SET_STATUSES);
export const subjectTypeEnum = pgEnum('subject_type', SUBJECT_TYPES);

// Export artifacts (Phase 6).
export const exportTypeEnum = pgEnum('export_type', EXPORT_TYPES);
export const exportFormatEnum = pgEnum('export_format', EXPORT_FORMATS);
export const exportModeEnum = pgEnum('export_mode', EXPORT_MODES);
export const exportStatusEnum = pgEnum('export_status', EXPORT_STATUSES);
export const exportScopeTypeEnum = pgEnum('export_scope_type', EXPORT_SCOPE_TYPES);

export const agePolicyEnum = pgEnum('age_policy', AGE_POLICIES);
export const playUpPolicyEnum = pgEnum('play_up_policy', PLAY_UP_POLICIES);
export const partitionDimensionEnum = pgEnum('partition_dimension', PARTITION_DIMENSIONS);
export const toleranceDimensionEnum = pgEnum('tolerance_dimension', TOLERANCE_DIMENSIONS);
export const toleranceMaxStatusEnum = pgEnum('tolerance_max_status', ['UNSET', 'NONE', 'SET']);
export const beltPolicyEnum = pgEnum('belt_policy', BELT_POLICIES);
export const singletonPolicyEnum = pgEnum('singleton_policy', SINGLETON_POLICIES);
export const byePolicyEnum = pgEnum('bye_policy', BYE_POLICIES);
export const contingentKeyEnum = pgEnum('contingent_key', CONTINGENT_KEYS);
export const genderModeEnum = pgEnum('gender_mode', ['BY_ENTRY', 'MIXED']);
export const bandPurposeEnum = pgEnum('band_purpose', ['MOVEMENT', 'COMPATIBILITY']);
export const tableCompletenessEnum = pgEnum('table_completeness', ['OFFICIAL', 'OBSERVED_SUBSET']);
export const actorKindEnum = pgEnum('actor_kind', ['USER', 'SYSTEM']);

// Intake (Phase 2).
export const provenanceSourceEnum = pgEnum('provenance_source', PROVENANCE_SOURCES);
export const transformationOutcomeEnum = pgEnum('transformation_outcome', [
  'UNCHANGED',
  'MAPPED',
  'NORMALIZED',
  'INVALID',
]);
/** Decision on a field transformation: recorded once, by a person, with a reason. */
export const resolutionStatusEnum = pgEnum('resolution_status', [
  'UNRESOLVED',
  'ACCEPTED',
  'REJECTED',
  'CORRECTED',
]);
