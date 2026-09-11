import type { ConfidenceLevel, EntryFormat, EntryGroupSource, EntryGroupStatus, Gender } from './enums.js';

/**
 * How the members of a pair/team entry were grouped (ADR-0010). The registration export in
 * 2026 had no entry identifier (SOURCE_ANALYSIS F-03), so grouping provenance matters.
 *
 * EXPLICIT  — the registration system supplied an entry/team identifier.
 * IMPORTED  — an operator-supplied grouping column in the uploaded file.
 * HEURISTIC — inferred by the system (contingent + category + member composition).
 * MANUAL    — created by an operator in the application.
 */
export interface EntryGroupProvenance {
  readonly source: EntryGroupSource;
  readonly status: EntryGroupStatus;
  readonly confidence: ConfidenceLevel;
  readonly confirmedBy: string | null;
}

/** A group is final — usable by the draw — only when CONFIRMED, and a heuristic group only when a person confirmed it. */
export function isEntryGroupFinal(g: EntryGroupProvenance): boolean {
  if (g.status !== 'CONFIRMED') return false;
  if (g.source === 'HEURISTIC' || g.source === 'MANUAL') return g.confirmedBy !== null;
  return true;
}

/** Initial status assigned when a group is created from a given source. */
export function initialGroupStatus(source: EntryGroupSource): EntryGroupStatus {
  return source === 'HEURISTIC' ? 'PROPOSED' : 'CONFIRMED';
}

export interface CompositionRule {
  readonly format: EntryFormat;
  readonly size: number;
  /** Required gender composition; `null` = members must all share one gender. */
  readonly genders: readonly Gender[] | null;
}

/** Default compositions observed in 2026 (SOURCE_ANALYSIS F-04, R-11). Configurable per rule set. */
export const DEFAULT_COMPOSITION: readonly CompositionRule[] = [
  { format: 'INDIVIDUAL', size: 1, genders: null },
  { format: 'PAIR', size: 2, genders: ['FEMALE', 'MALE'] },
  { format: 'TEAM', size: 3, genders: null },
];

export type CompositionViolation = 'WRONG_SIZE' | 'WRONG_GENDER_COMPOSITION' | 'DUPLICATE_MEMBER';

export function checkComposition(
  rule: CompositionRule,
  members: readonly { readonly athleteId: string; readonly gender: Gender }[],
): CompositionViolation[] {
  const violations: CompositionViolation[] = [];
  if (members.length !== rule.size) violations.push('WRONG_SIZE');
  if (new Set(members.map((m) => m.athleteId)).size !== members.length) violations.push('DUPLICATE_MEMBER');
  const genders = members.map((m) => m.gender).sort();
  if (rule.genders === null) {
    if (new Set(genders).size > 1) violations.push('WRONG_GENDER_COMPOSITION');
  } else if (genders.join('|') !== [...rule.genders].sort().join('|')) {
    violations.push('WRONG_GENDER_COMPOSITION');
  }
  return violations;
}
