import type { CorrectableField, IssueSeverity, Role } from './enums.js';

/**
 * Data-quality issue catalog (SOURCE_ANALYSIS §6). Severity here is the default; the
 * validation stage may lower it when the active rule set does not use the affected field
 * (e.g. a missing height is irrelevant to a prestasi Kyorugi draw).
 */
export interface IssueDefinition {
  readonly code: IssueCode;
  readonly defaultSeverity: IssueSeverity;
  readonly field:
    | CorrectableField
    | 'CLASS'
    | 'CLASSIFICATION'
    | 'DIVISION'
    | 'ENTRY_GROUP'
    | 'CONTINGENT'
    | 'DATE'
    | 'IDENTITY'
    | 'CATEGORY'
    | null;
  /** Technical Delegate may override an ERROR of this code with a reason (ADR-0011). */
  readonly overridable: boolean;
  /** True when the system can propose a concrete corrected value for operator acceptance. */
  readonly suggestsCorrection: boolean;
}

export const ISSUE_CODES = [
  'HEIGHT_MISSING',
  'WEIGHT_MISSING',
  'HEIGHT_WEIGHT_LIKELY_SWAPPED',
  'HEIGHT_OUT_OF_RANGE',
  'WEIGHT_OUT_OF_RANGE',
  'BMI_IMPLAUSIBLE',
  'WEIGHT_CLASS_MISMATCH',
  'AGE_DIVISION_PLAY_UP',
  'AGE_DIVISION_CONFLICT',
  'NIK_INVALID_FORMAT',
  'NIK_NORMALIZED',
  'NIK_GENDER_MISMATCH',
  'NIK_BIRTHDATE_MISMATCH',
  'DOB_POSSIBLE_PLACEHOLDER',
  'ATHLETE_ATTRIBUTE_CONFLICT',
  'ATHLETE_MULTIPLE_CONTINGENTS',
  'ENTRY_GROUP_AMBIGUOUS',
  'ENTRY_GROUP_INCOMPLETE',
  'ENTRY_GROUP_UNCONFIRMED',
  'CLASS_FORMAT_NORMALIZED',
  'UNKNOWN_CLASS',
  'UNKNOWN_BELT',
  'UNKNOWN_DIVISION',
  'INVALID_DATE',
  // Phase 2 (docs/PHASE2_PLAN.md §3-§7)
  'INVALID_NUMBER',
  'UNKNOWN_GENDER',
  'UNKNOWN_CLASSIFICATION',
  'AMBIGUOUS_WEIGHT_CLASS',
  'DUPLICATE_SOURCE_ID',
  'NAME_MISSING',
  'NIK_MISSING',
  'POSSIBLE_DUPLICATE_PERSON',
  'CONTINGENT_FIELDS_DIFFER',
  'NO_CATEGORY_TEMPLATE',
  'MOVEMENT_UNRESOLVED',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

const def = (
  code: IssueCode,
  defaultSeverity: IssueSeverity,
  field: IssueDefinition['field'],
  overridable: boolean,
  suggestsCorrection = false,
): IssueDefinition => ({ code, defaultSeverity, field, overridable, suggestsCorrection });

/**
 * Overridable = a Technical Delegate may explicitly accept the risk of drawing with this data.
 * Not overridable = the engine cannot operate correctly without a correction (unknown class,
 * ambiguous pair) — override would not make the draw safe, only silent.
 */
export const ISSUE_CATALOG: Readonly<Record<IssueCode, IssueDefinition>> = {
  HEIGHT_MISSING: def('HEIGHT_MISSING', 'ERROR', 'HEIGHT', false),
  WEIGHT_MISSING: def('WEIGHT_MISSING', 'ERROR', 'WEIGHT', false),
  HEIGHT_WEIGHT_LIKELY_SWAPPED: def('HEIGHT_WEIGHT_LIKELY_SWAPPED', 'ERROR', 'HEIGHT', true, true),
  HEIGHT_OUT_OF_RANGE: def('HEIGHT_OUT_OF_RANGE', 'ERROR', 'HEIGHT', true),
  WEIGHT_OUT_OF_RANGE: def('WEIGHT_OUT_OF_RANGE', 'ERROR', 'WEIGHT', true),
  BMI_IMPLAUSIBLE: def('BMI_IMPLAUSIBLE', 'WARNING', 'WEIGHT', true),
  WEIGHT_CLASS_MISMATCH: def('WEIGHT_CLASS_MISMATCH', 'WARNING', 'WEIGHT', true),
  AGE_DIVISION_PLAY_UP: def('AGE_DIVISION_PLAY_UP', 'WARNING', 'BIRTH_DATE', true),
  AGE_DIVISION_CONFLICT: def('AGE_DIVISION_CONFLICT', 'ERROR', 'BIRTH_DATE', true),
  NIK_INVALID_FORMAT: def('NIK_INVALID_FORMAT', 'WARNING', 'NIK', true),
  NIK_NORMALIZED: def('NIK_NORMALIZED', 'INFO', 'NIK', false),
  NIK_GENDER_MISMATCH: def('NIK_GENDER_MISMATCH', 'WARNING', 'GENDER', true),
  NIK_BIRTHDATE_MISMATCH: def('NIK_BIRTHDATE_MISMATCH', 'WARNING', 'BIRTH_DATE', true),
  DOB_POSSIBLE_PLACEHOLDER: def('DOB_POSSIBLE_PLACEHOLDER', 'INFO', 'BIRTH_DATE', false),
  ATHLETE_ATTRIBUTE_CONFLICT: def('ATHLETE_ATTRIBUTE_CONFLICT', 'ERROR', 'BELT', false),
  ATHLETE_MULTIPLE_CONTINGENTS: def('ATHLETE_MULTIPLE_CONTINGENTS', 'INFO', 'CONTINGENT', false),
  ENTRY_GROUP_AMBIGUOUS: def('ENTRY_GROUP_AMBIGUOUS', 'ERROR', 'ENTRY_GROUP', false),
  ENTRY_GROUP_INCOMPLETE: def('ENTRY_GROUP_INCOMPLETE', 'ERROR', 'ENTRY_GROUP', false),
  ENTRY_GROUP_UNCONFIRMED: def('ENTRY_GROUP_UNCONFIRMED', 'ERROR', 'ENTRY_GROUP', false),
  CLASS_FORMAT_NORMALIZED: def('CLASS_FORMAT_NORMALIZED', 'INFO', 'CLASS', false),
  UNKNOWN_CLASS: def('UNKNOWN_CLASS', 'ERROR', 'CLASS', false),
  UNKNOWN_BELT: def('UNKNOWN_BELT', 'ERROR', 'BELT', false),
  UNKNOWN_DIVISION: def('UNKNOWN_DIVISION', 'ERROR', 'DIVISION', false),
  INVALID_DATE: def('INVALID_DATE', 'ERROR', 'DATE', false),
  INVALID_NUMBER: def('INVALID_NUMBER', 'ERROR', 'HEIGHT', false),
  UNKNOWN_GENDER: def('UNKNOWN_GENDER', 'ERROR', 'GENDER', false),
  UNKNOWN_CLASSIFICATION: def('UNKNOWN_CLASSIFICATION', 'ERROR', 'CLASSIFICATION', false),
  // A bare "53" is a spreadsheet formula corruption of "=+53" or "-53" (F-37): never guessed.
  AMBIGUOUS_WEIGHT_CLASS: def('AMBIGUOUS_WEIGHT_CLASS', 'ERROR', 'CLASS', false, true),
  DUPLICATE_SOURCE_ID: def('DUPLICATE_SOURCE_ID', 'ERROR', 'IDENTITY', false),
  NAME_MISSING: def('NAME_MISSING', 'ERROR', 'FULL_NAME', false),
  NIK_MISSING: def('NIK_MISSING', 'WARNING', 'NIK', false),
  POSSIBLE_DUPLICATE_PERSON: def('POSSIBLE_DUPLICATE_PERSON', 'WARNING', 'IDENTITY', false),
  CONTINGENT_FIELDS_DIFFER: def('CONTINGENT_FIELDS_DIFFER', 'WARNING', 'CONTINGENT', false),
  NO_CATEGORY_TEMPLATE: def('NO_CATEGORY_TEMPLATE', 'ERROR', 'CATEGORY', false),
  MOVEMENT_UNRESOLVED: def('MOVEMENT_UNRESOLVED', 'ERROR', 'CATEGORY', false),
};

/** Roles allowed to override a data-quality ERROR. Only the Technical Delegate (ADR-0011). */
export const OVERRIDE_ROLES: readonly Role[] = ['TECHNICAL_DELEGATE'];

/** Minimum length of an override reason; a reason must say something, not "ok". */
export const OVERRIDE_REASON_MIN_LENGTH = 15;
