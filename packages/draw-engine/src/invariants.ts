import { compareStrings, sortedBy } from '@bagantkd/shared';

/**
 * Safety invariants (docs/ACCEPTANCE_CRITERIA.md §2). These define correctness: every draw
 * that the system stores, locks or publishes must satisfy all of them, for every seed.
 * Historical quality (the 2026 committee baseline) is measured separately and never
 * substitutes for these checks.
 */
export const SAFETY_INVARIANTS = {
  'INV-01': 'No hard-constraint violation in any pool or bracket',
  'INV-02': 'No entry placed more than once in a revision',
  'INV-03': 'No eligible in-scope entry missing from the draw; no ineligible or unknown entry present',
  'INV-04':
    'Every bracket is structurally valid (power-of-two slots, byes = slots − entries, balanced halves, n − 1 matches, single final)',
  'INV-05':
    'Deterministic replay: identical input, rules, engine version and seed produce an identical output fingerprint',
  'INV-06':
    'Revision state is valid: lifecycle transitions legal, frozen content unchanged, one official revision per category',
  'INV-07': 'Audit trail is valid: append-only, hash chain intact, every mutation has an audit event',
  'INV-08': 'Manual seeds are never moved by automatic placement',
} as const;
export type InvariantId = keyof typeof SAFETY_INVARIANTS;

export interface InvariantViolation {
  readonly invariant: InvariantId;
  readonly code: string;
  readonly subject: string;
}

/**
 * INV-02 and INV-03 for a set of placements.
 * @param eligible entry ids that must appear exactly once
 * @param placements every (pool, entry) placement produced
 */
export function checkPlacementInvariants(
  eligible: readonly string[],
  placements: readonly { readonly poolUid: string; readonly entryId: string }[],
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const eligibleSet = new Set(eligible);
  const seen = new Map<string, number>();
  for (const p of placements) seen.set(p.entryId, (seen.get(p.entryId) ?? 0) + 1);

  for (const [entryId, count] of seen) {
    if (count > 1) out.push({ invariant: 'INV-02', code: 'DUPLICATE_ENTRY', subject: entryId });
    if (!eligibleSet.has(entryId))
      out.push({ invariant: 'INV-03', code: 'UNEXPECTED_ENTRY', subject: entryId });
  }
  for (const entryId of eligibleSet) {
    if (!seen.has(entryId)) out.push({ invariant: 'INV-03', code: 'MISSING_ENTRY', subject: entryId });
  }
  return sortedBy(
    out,
    (a, b) =>
      compareStrings(a.invariant, b.invariant) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.subject, b.subject),
  );
}
