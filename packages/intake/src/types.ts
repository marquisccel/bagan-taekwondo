import type {
  Discipline,
  EligibilityStatus,
  EntryFormat,
  Gender,
  IssueCode,
  IssueSeverity,
  Stream,
} from '@bagantkd/domain';
import type { PROVENANCE_SOURCES } from '@bagantkd/rules';

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/**
 * UNCHANGED  raw already canonical
 * MAPPED     vocabulary lookup (e.g. "Laki-laki" → MALE)
 * NORMALIZED format changed, meaning preserved ("=+53" → "+53", trailing "." on NIK)
 * INVALID    unusable; an issue explains why
 */
export type Outcome = 'UNCHANGED' | 'MAPPED' | 'NORMALIZED' | 'INVALID';

/** Which rule produced a value, and who decided that rule (instruction 8). */
export interface RuleRef {
  readonly code: string;
  readonly provenance: ProvenanceSource;
}

/**
 * A proposed correction. Never applied by the pipeline: each alternative is a map of source
 * column → corrected raw value, awaiting a person's decision.
 */
export interface Suggestion {
  readonly rule: string;
  readonly alternatives: readonly Readonly<Record<string, string>>[];
}

/** RAW → NORMALIZED trace of one field (PHASE2_PLAN §2). `raw` is always the exact input. */
export interface Trace<T> {
  readonly raw: string;
  readonly value: T | null;
  readonly outcome: Outcome;
  readonly rule: RuleRef;
  readonly suggestion: Suggestion | null;
}

export type SubjectKind = 'ROW' | 'PERSON' | 'ENTRY';

export interface IntakeIssue {
  readonly code: IssueCode;
  /** Sub-classification, e.g. NIK_BIRTHDATE_MISMATCH → YEAR | DAY_MONTH. */
  readonly component: string | null;
  readonly severity: IssueSeverity;
  readonly subject: { readonly kind: SubjectKind; readonly ref: string };
  readonly field: string | null;
  readonly raw: string | null;
  readonly suggestion: Suggestion | null;
  readonly rule: RuleRef;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface SourceRecord {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
}

export interface NormalizedFields {
  readonly sourceId: Trace<string>;
  readonly name: Trace<string>;
  readonly gender: Trace<Gender>;
  readonly birthDate: Trace<string>;
  readonly heightMm: Trace<number>;
  readonly weightG: Trace<number>;
  readonly belt: Trace<string>;
  readonly classification: Trace<string>;
  readonly division: Trace<string>;
  readonly classOrFormat: Trace<string>;
  readonly nik: Trace<string>;
  readonly contingent: Trace<string>;
}

export interface NormalizedRow {
  readonly rowNumber: number;
  readonly ref: string;
  readonly fields: NormalizedFields;
  readonly stream: Stream | null;
  readonly discipline: Discipline | null;
  readonly format: EntryFormat;
  readonly weightClass: string | null;
  readonly templateCode: string | null;
  readonly heightUsable: boolean;
  readonly weightUsable: boolean;
  readonly birthYear: number | null;
  readonly issues: readonly IntakeIssue[];
}

export type ConflictField = 'FULL_NAME' | 'GENDER' | 'BIRTH_DATE' | 'HEIGHT' | 'WEIGHT' | 'BELT';

export interface Person {
  readonly key: string;
  /** Stable pseudonymous reference: never derived from NIK or name. */
  readonly ref: string;
  readonly rowRefs: readonly string[];
  readonly gender: Gender | null;
  readonly birthYear: number | null;
  readonly heightMm: number | null;
  readonly weightG: number | null;
  readonly beltCode: string | null;
  readonly conflicts: readonly ConflictField[];
  readonly contingents: readonly string[];
}

export interface EntryGroupProposal {
  readonly source: 'HEURISTIC';
  readonly status: 'PROPOSED';
  readonly confidence: 'HIGH';
  readonly evidence: {
    readonly rule: string;
    readonly provenance: ProvenanceSource;
    readonly groupKey: string;
    readonly memberRows: readonly string[];
  };
}

export interface IntakeEntry {
  readonly ref: string;
  readonly memberRows: readonly string[];
  readonly stream: Stream | null;
  readonly discipline: Discipline | null;
  readonly format: EntryFormat;
  readonly divisionCode: string | null;
  readonly weightClass: string | null;
  readonly contingent: string;
  readonly group: EntryGroupProposal | null;
  readonly templateCode: string | null;
  readonly categoryKey: string | null;
  readonly categoryGender: 'MALE' | 'FEMALE' | 'MIXED' | null;
  readonly issues: readonly IntakeIssue[];
  readonly eligibility: EligibilityStatus;
  readonly blockingReasons: readonly string[];
}

export interface CategorySummary {
  readonly key: string;
  readonly templateCode: string;
  readonly stream: Stream;
  readonly discipline: Discipline;
  readonly entries: number;
  readonly eligible: number;
  readonly blocked: number;
}
