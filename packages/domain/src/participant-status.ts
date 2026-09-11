import type { EligibilityStatus, RegistrationStatus } from './enums.js';

/**
 * Two independent concerns (ADR-0011):
 * - RegistrationStatus — administrative facts (registered, verified, withdrew, disqualified, absent).
 * - EligibilityStatus  — whether the draw engine may place the entry under the active rule set.
 *
 * VERIFIED does not imply READY: a verified athlete can still be BLOCKED by a missing rule
 * (e.g. an unknown weight class) or an unresolved data-quality ERROR.
 */
const REGISTRATION_TRANSITIONS: Readonly<Record<RegistrationStatus, readonly RegistrationStatus[]>> = {
  REGISTERED: ['VERIFIED', 'WITHDRAWN', 'DQ', 'NO_SHOW'],
  VERIFIED: ['WITHDRAWN', 'DQ', 'NO_SHOW'],
  WITHDRAWN: [],
  DQ: [],
  NO_SHOW: [],
};

export function canChangeRegistration(from: RegistrationStatus, to: RegistrationStatus): boolean {
  return REGISTRATION_TRANSITIONS[from].includes(to);
}

/** Entries in these registration states are out of the competition and never drawn. */
export const isRegistrationTerminal = (s: RegistrationStatus): boolean =>
  s === 'WITHDRAWN' || s === 'DQ' || s === 'NO_SHOW';

export interface EligibilityInputs {
  readonly registration: RegistrationStatus;
  /** Unresolved ERROR issues that are not covered by an active override. */
  readonly openBlockingIssues: number;
  /** ERROR issues covered by an active Technical Delegate override. */
  readonly overriddenIssues: number;
  /** Rule-set gaps that prevent categorization (unknown class, missing movement map, …). */
  readonly ruleGaps: number;
  /** Pair/team group is not CONFIRMED, or not required (individual). */
  readonly entryGroupFinal: boolean;
  /** Entry is placed in a LOCKED or PUBLISHED revision. */
  readonly inLockedRevision: boolean;
}

/**
 * Derives eligibility. Pure and total: every input combination has exactly one result,
 * which the property tests enumerate exhaustively.
 */
export function deriveEligibility(i: EligibilityInputs): EligibilityStatus {
  if (isRegistrationTerminal(i.registration)) return 'BLOCKED';
  if (i.openBlockingIssues > 0 || i.ruleGaps > 0 || !i.entryGroupFinal) return 'BLOCKED';
  if (i.inLockedRevision) return 'DRAWN';
  return i.overriddenIssues > 0 ? 'OVERRIDDEN' : 'READY';
}

/** The engine may place entries in exactly these eligibility states. */
export const isPlaceable = (s: EligibilityStatus): boolean =>
  s === 'READY' || s === 'OVERRIDDEN' || s === 'DRAWN';
