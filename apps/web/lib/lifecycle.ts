export const LIFECYCLE_STEPS = ['DRAFT', 'REVIEW', 'APPROVED', 'LOCKED', 'PUBLISHED', 'AMENDED'] as const;
export type Lifecycle = (typeof LIFECYCLE_STEPS)[number] | 'SUPERSEDED';

/**
 * Mirrors packages/domain/src/rbac.ts's action→minimum-role table for UI hinting ONLY (show/hide,
 * never enforce — the backend re-checks every command; see ACCEPTANCE §F). Keeping the same shape
 * as the backend's own table, not inventing a new one, so a future rank change is one file to
 * touch and this one to mirror, not independent logic.
 */
export type Role = 'VIEWER' | 'DRAWING_OFFICER' | 'TECHNICAL_DELEGATE' | 'ADMIN';
const RANK: Record<Role, number> = { VIEWER: 0, DRAWING_OFFICER: 1, TECHNICAL_DELEGATE: 2, ADMIN: 3 };
const atLeast = (role: Role | null, min: Role) => !!role && RANK[role] >= RANK[min];

export interface LifecycleAction {
  readonly action: 'submit-review' | 'approve' | 'lock' | 'publish' | 'amend';
  readonly label: string;
  readonly minRole: Role;
}

const NEXT_ACTION: Partial<Record<Lifecycle, LifecycleAction>> = {
  DRAFT: { action: 'submit-review', label: 'Submit for review', minRole: 'DRAWING_OFFICER' },
  REVIEW: { action: 'approve', label: 'Approve', minRole: 'TECHNICAL_DELEGATE' },
  APPROVED: { action: 'lock', label: 'Lock', minRole: 'TECHNICAL_DELEGATE' },
  LOCKED: { action: 'publish', label: 'Publish', minRole: 'TECHNICAL_DELEGATE' },
  PUBLISHED: { action: 'amend', label: 'Amend', minRole: 'TECHNICAL_DELEGATE' },
};

export function nextLifecycleAction(lifecycle: string): LifecycleAction | null {
  return NEXT_ACTION[lifecycle as Lifecycle] ?? null;
}

export function canAttempt(role: Role | null, action: LifecycleAction): boolean {
  return atLeast(role, action.minRole);
}

/** Content commands (move/swap/etc.) only apply to a DRAFT revision — matches acceptsDrawCommands(). */
export const isDraft = (lifecycle: string): boolean => lifecycle === 'DRAFT';
