/**
 * Enumerations shared by the domain, the rule-set model and the database schema.
 * The database pgEnums are generated from these arrays, so there is one source of truth.
 */
const values = <const T extends readonly string[]>(...v: T): T => v;

export const STREAMS = values('PRESTASI', 'SEMI_PRESTASI');
export type Stream = (typeof STREAMS)[number];

export const DISCIPLINES = values('KYORUGI', 'POOMSAE', 'FREESTYLE_POOMSAE');
export type Discipline = (typeof DISCIPLINES)[number];

export const ENTRY_FORMATS = values('INDIVIDUAL', 'PAIR', 'TEAM');
export type EntryFormat = (typeof ENTRY_FORMATS)[number];

export const GENDERS = values('MALE', 'FEMALE');
export type Gender = (typeof GENDERS)[number];

/** A category may be MIXED (Poomsae pair: one male + one female — SOURCE_ANALYSIS F-04). */
export const CATEGORY_GENDERS = values('MALE', 'FEMALE', 'MIXED');
export type CategoryGender = (typeof CATEGORY_GENDERS)[number];

/** Registration lifecycle of an entry: what happened administratively. */
export const REGISTRATION_STATUSES = values('REGISTERED', 'VERIFIED', 'WITHDRAWN', 'DQ', 'NO_SHOW');
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * Draw eligibility of an entry under the active rule set: whether the engine may place it.
 * Independent of registration status — VERIFIED does not imply READY (ADR-0011).
 */
export const ELIGIBILITY_STATUSES = values('BLOCKED', 'READY', 'OVERRIDDEN', 'DRAWN');
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const ENTRY_GROUP_SOURCES = values('EXPLICIT', 'IMPORTED', 'HEURISTIC', 'MANUAL');
export type EntryGroupSource = (typeof ENTRY_GROUP_SOURCES)[number];

export const ENTRY_GROUP_STATUSES = values('PROPOSED', 'CONFIRMED', 'REJECTED');
export type EntryGroupStatus = (typeof ENTRY_GROUP_STATUSES)[number];

export const CONFIDENCE_LEVELS = values('HIGH', 'MEDIUM', 'LOW');
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const ISSUE_SEVERITIES = values('ERROR', 'WARNING', 'INFO');
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_STATUSES = values('OPEN', 'ACKNOWLEDGED', 'OVERRIDDEN', 'CORRECTED', 'RESOLVED');
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const MEASUREMENT_SOURCES = values('REGISTERED_DATA', 'VERIFIED_WEIGH_IN');
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

export const CORRECTABLE_FIELDS = values(
  'HEIGHT',
  'WEIGHT',
  'BELT',
  'GENDER',
  'BIRTH_DATE',
  'NIK',
  'FULL_NAME',
);
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export const DRAW_RUN_KINDS = values('SIMULATION', 'CANDIDATE');
export type DrawRunKind = (typeof DRAW_RUN_KINDS)[number];

export const DRAW_RUN_STATUSES = values('QUEUED', 'RUNNING', 'SAFE', 'UNSAFE', 'FAILED');
export type DrawRunStatus = (typeof DRAW_RUN_STATUSES)[number];

export const CATEGORY_READINESS = values('READY', 'BLOCKED');
export type CategoryReadiness = (typeof CATEGORY_READINESS)[number];

export const REVISION_LIFECYCLES = values(
  'DRAFT',
  'REVIEW',
  'APPROVED',
  'LOCKED',
  'PUBLISHED',
  'AMENDED',
  'SUPERSEDED',
);
export type RevisionLifecycle = (typeof REVISION_LIFECYCLES)[number];

export const POOL_STRATEGIES = values(
  'WEIGHT_FIRST',
  'HEIGHT_FIRST',
  'BELT_FIRST',
  'BALANCED',
  'CONTINGENT_AWARE',
);
export type PoolStrategy = (typeof POOL_STRATEGIES)[number];

export const DRAW_FORMATS = values('SINGLE_ELIMINATION', 'POOLED_SINGLE_ELIMINATION', 'PERFORMANCE_ORDER');
export type DrawFormat = (typeof DRAW_FORMATS)[number];

export const MATCH_STATUSES = values('PENDING', 'WALKOVER', 'VOID');
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const COMMAND_OUTCOMES = values('APPLIED', 'REJECTED');
export type CommandOutcome = (typeof COMMAND_OUTCOMES)[number];

export const COMPLAINT_STATUSES = values('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'RESOLVED');
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const ROLES = values('ADMIN', 'DRAWING_OFFICER', 'TECHNICAL_DELEGATE', 'VIEWER');
export type Role = (typeof ROLES)[number];

export const IMPORT_BATCH_STATUSES = values('UPLOADED', 'PARSED', 'VALIDATED', 'COMMITTED', 'FAILED');
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const TOURNAMENT_STATUSES = values('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const RULE_SET_STATUSES = values('DRAFT', 'ACTIVE', 'RETIRED');
export type RuleSetStatus = (typeof RULE_SET_STATUSES)[number];

export const SUBJECT_TYPES = values(
  'IMPORT_ROW',
  'ATHLETE',
  'ENTRY',
  'ENTRY_GROUP',
  'CATEGORY',
  'RULE_SET',
  'DRAW_RUN',
  'DRAW_REVISION',
  'POOL',
  'MATCH',
  'COMPLAINT',
  'VALIDATION_ISSUE',
  'TOURNAMENT',
  'EXPORT_ARTIFACT',
);
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** Phase 6: official tournament outputs rendered from one immutable revision — the layer renders, it never decides. */
export const EXPORT_TYPES = values(
  'TOURNAMENT_DRAW_BOOK',
  'CATEGORY_DRAW',
  'POOL_SHEET',
  'BRACKET_SHEET',
  'XLSX_WORKBOOK',
  // AUD-012: dense semi-prestasi tournament-desk sheet (PDF only).
  'SEMI_PRESTASI_COMPACT_DRAW_SHEET',
);
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_FORMATS = values('PDF', 'XLSX');
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** PREVIEW is watermarked and available from any state permitted below; OFFICIAL requires LOCKED/PUBLISHED/AMENDED. */
export const EXPORT_MODES = values('PREVIEW', 'OFFICIAL');
export type ExportMode = (typeof EXPORT_MODES)[number];

export const EXPORT_STATUSES = values('REQUESTED', 'GENERATING', 'READY', 'FAILED');
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** What an export is scoped to: the whole revision (draw book, workbook) or one category/pool within it. */
export const EXPORT_SCOPE_TYPES = values('REVISION', 'CATEGORY', 'POOL');
export type ExportScopeType = (typeof EXPORT_SCOPE_TYPES)[number];
