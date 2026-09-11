import type { RevisionAction } from './revision-lifecycle.js';

/**
 * Domain commands against a draw revision (ADR-0004). Commands are the only way a revision
 * changes; each one is validated, produces a new revision (or a lifecycle transition), and
 * appends an audit event in the same transaction.
 */
interface CommandBase {
  readonly revisionId: string;
  /** Optimistic concurrency: the lock_version the client saw. */
  readonly expectedLockVersion: number;
  /** Replays with the same key return the original outcome instead of applying twice. */
  readonly idempotencyKey: string;
  /** Required when the command worsens a soft constraint (YELLOW) and for every lifecycle action. */
  readonly reason: string | null;
  readonly complaintId: string | null;
}

export type DrawCommand =
  | (CommandBase & {
      readonly type: 'MOVE_ENTRY';
      readonly entryId: string;
      readonly toPoolUid: string;
      readonly toSlot: number | null;
    })
  | (CommandBase & { readonly type: 'SWAP_ENTRIES'; readonly entryA: string; readonly entryB: string })
  | (CommandBase & {
      readonly type: 'MOVE_POOL';
      readonly poolUid: string;
      readonly toArenaCode: string;
      readonly toOrder: number;
    })
  | (CommandBase & {
      readonly type: 'ADD_ENTRY';
      readonly entryId: string;
      readonly toPoolUid: string | null;
    })
  | (CommandBase & {
      readonly type: 'REMOVE_ENTRY';
      readonly entryId: string;
      readonly because: 'WITHDRAWN' | 'DQ' | 'NO_SHOW' | 'CATEGORY_CHANGE';
    })
  | (CommandBase & { readonly type: 'REGENERATE_POOL'; readonly poolUid: string })
  | (CommandBase & { readonly type: 'REGENERATE_CATEGORY'; readonly categoryId: string })
  | (CommandBase & { readonly type: 'SET_SEED'; readonly entryId: string; readonly seedNo: number | null })
  | (CommandBase & { readonly type: 'ACKNOWLEDGE_WARNING'; readonly findingId: string })
  | (CommandBase & { readonly type: 'LIFECYCLE'; readonly action: RevisionAction });

export type DrawCommandType = DrawCommand['type'];

/** Command validation feedback shared by client (predictive) and server (authoritative). */
export type ConstraintVerdict =
  | { readonly level: 'GREEN' }
  | { readonly level: 'YELLOW'; readonly softViolations: readonly string[]; readonly reasonRequired: true }
  | { readonly level: 'RED'; readonly hardViolations: readonly string[] };
