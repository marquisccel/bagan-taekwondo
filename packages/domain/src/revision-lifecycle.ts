import type { RevisionLifecycle } from './enums.js';

/**
 * Draw revision lifecycle (ADR-0004).
 *
 *   DRAFT ─submit→ REVIEW ─approve→ APPROVED ─lock→ LOCKED ─publish→ PUBLISHED
 *     ▲               │                  │                               │
 *     └────reject─────┴──────reopen──────┘                    amend ─────┤ (child revision created)
 *                                                                        ▼
 *                                          AMENDED ─abandon→ PUBLISHED   │
 *                                             └─ child published → SUPERSEDED
 *
 * - Only DRAFT accepts draw commands.
 * - LOCKED can only be left by publishing: a locked revision is the one about to be printed.
 * - PUBLISHED is never modified; `amend` marks it AMENDED and creates a child DRAFT.
 *   While AMENDED it is still the official result.
 * - SUPERSEDED is terminal.
 */
export const REVISION_ACTIONS = [
  'SUBMIT',
  'REJECT',
  'APPROVE',
  'REOPEN',
  'LOCK',
  'PUBLISH',
  'AMEND',
  'ABANDON_AMENDMENT',
  'SUPERSEDE',
] as const;
export type RevisionAction = (typeof REVISION_ACTIONS)[number];

const TRANSITIONS: Readonly<Record<RevisionLifecycle, Partial<Record<RevisionAction, RevisionLifecycle>>>> = {
  DRAFT: { SUBMIT: 'REVIEW' },
  REVIEW: { REJECT: 'DRAFT', APPROVE: 'APPROVED' },
  APPROVED: { REOPEN: 'DRAFT', LOCK: 'LOCKED' },
  LOCKED: { PUBLISH: 'PUBLISHED' },
  PUBLISHED: { AMEND: 'AMENDED' },
  AMENDED: { ABANDON_AMENDMENT: 'PUBLISHED', SUPERSEDE: 'SUPERSEDED' },
  SUPERSEDED: {},
};

export function nextLifecycle(
  from: RevisionLifecycle,
  action: RevisionAction,
): RevisionLifecycle | undefined {
  return TRANSITIONS[from][action];
}

export function allowedActions(from: RevisionLifecycle): RevisionAction[] {
  return Object.keys(TRANSITIONS[from]) as RevisionAction[];
}

/** Draw commands (move, swap, regenerate …) are accepted only on DRAFT revisions. */
export const acceptsDrawCommands = (state: RevisionLifecycle): boolean => state === 'DRAFT';

/** The revision whose content is the official, printed result for its categories. */
export const isOfficial = (state: RevisionLifecycle): boolean => state === 'PUBLISHED' || state === 'AMENDED';

/** A revision's content can no longer change once it reaches one of these states. */
export const isContentFrozen = (state: RevisionLifecycle): boolean =>
  state === 'LOCKED' || state === 'PUBLISHED' || state === 'AMENDED' || state === 'SUPERSEDED';
