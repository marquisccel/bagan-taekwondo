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

/**
 * Aggregate pool-quality figures of the pools a MOVE_ENTRY / SWAP_ENTRIES touched, computed by the
 * draw engine's own pool cost (packages/draw-engine/src/impact.ts). Integer units only.
 */
export interface VerdictMetrics {
  readonly tier0: number;
  readonly tier1Fp: number;
  readonly tier2Fp: number;
  readonly spread: number;
  readonly sizePenaltyFp: number;
  readonly singletons: number;
  readonly ranges: Readonly<Record<string, number>>;
  readonly excess: Readonly<Record<string, number>>;
}

/** Structured, machine-readable impact of a pool-changing command (AUD-005). */
export interface VerdictImpact {
  readonly change: 'IMPROVED' | 'UNCHANGED' | 'WORSE';
  readonly poolUids: readonly string[];
  readonly before: VerdictMetrics;
  readonly after: VerdictMetrics;
}

/**
 * Command verdict, authoritative on the server (the client never computes one).
 * GREEN: no meaningful degradation. YELLOW: valid, but a soft-constraint quality degradation; the
 * operator must give a reason. RED: hard rule violation — the command is refused, nothing changes.
 * `impact` is present for pool-changing commands on pooled categories.
 */
export type ConstraintVerdict =
  | { readonly level: 'GREEN'; readonly impact?: VerdictImpact }
  | {
      readonly level: 'YELLOW';
      readonly softViolations: readonly string[];
      readonly reasonRequired: true;
      readonly impact?: VerdictImpact;
    }
  | { readonly level: 'RED'; readonly hardViolations: readonly string[]; readonly impact?: VerdictImpact };
