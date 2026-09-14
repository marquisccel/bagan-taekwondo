import type { DrawCommandType } from './commands.js';
import type { RevisionAction } from './revision-lifecycle.js';
import type { Role } from './enums.js';

/**
 * Tournament-scoped RBAC (Phase 4). A role is never trusted from the client: the backend always
 * resolves it server-side from `tournament_member` for the (tournament, actor) pair before
 * authorizing a mutation. `ADMIN` can do everything `TECHNICAL_DELEGATE` can, `TECHNICAL_DELEGATE`
 * everything `DRAWING_OFFICER` can; `VIEWER` can mutate nothing.
 */
const RANK: Readonly<Record<Role, number>> = {
  VIEWER: 0,
  DRAWING_OFFICER: 1,
  TECHNICAL_DELEGATE: 2,
  ADMIN: 3,
};

const atLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

/** Content-mutating commands: any DRAWING_OFFICER+ may issue them. */
const OFFICER_COMMANDS: ReadonlySet<DrawCommandType> = new Set([
  'MOVE_ENTRY',
  'SWAP_ENTRIES',
  'MOVE_POOL',
  'ADD_ENTRY',
  'REMOVE_ENTRY',
  'REGENERATE_POOL',
  'REGENERATE_CATEGORY',
  'SET_SEED',
]);

/** Technical Delegate permissions: data-quality overrides, locking, publishing, amendments, warning acknowledgement. */
const DELEGATE_LIFECYCLE_ACTIONS: ReadonlySet<RevisionAction> = new Set([
  'APPROVE',
  'LOCK',
  'PUBLISH',
  'AMEND',
]);
const OFFICER_LIFECYCLE_ACTIONS: ReadonlySet<RevisionAction> = new Set([
  'SUBMIT',
  'REJECT',
  'REOPEN',
  'ABANDON_AMENDMENT',
  'SUPERSEDE',
]);

export function canPerformCommand(role: Role, type: DrawCommandType): boolean {
  if (type === 'ACKNOWLEDGE_WARNING') return atLeast(role, 'TECHNICAL_DELEGATE');
  if (OFFICER_COMMANDS.has(type)) return atLeast(role, 'DRAWING_OFFICER');
  return false;
}

export function canPerformLifecycle(role: Role, action: RevisionAction): boolean {
  if (DELEGATE_LIFECYCLE_ACTIONS.has(action)) return atLeast(role, 'TECHNICAL_DELEGATE');
  if (OFFICER_LIFECYCLE_ACTIONS.has(action)) return atLeast(role, 'DRAWING_OFFICER');
  return false;
}

/** Data-quality overrides also require a Technical Delegate (ADR-0011), enforced again here for RBAC. */
export const canOverrideDataQuality = (role: Role): boolean => atLeast(role, 'TECHNICAL_DELEGATE');

/** VIEWER (and anyone unresolved) can only read. */
export const canRead = (role: Role | null): boolean => role !== null;
