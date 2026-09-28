import type { ExportBracketSlot, ExportMatch } from '../model.js';

/**
 * Pure layout geometry for the visual bracket (ACCEPTANCE §4/§5) — computes WHERE to draw each
 * match and connector, entirely from the already-persisted feeder relationships (`ExportMatch.feederA/B`,
 * which carry the exact `bracket_slot`/`match` links written by the frozen Phase 3 engine). This
 * file decides pixel coordinates only; it never decides who plays whom, never infers a winner, and
 * never recomputes round/position — those are read as given from the model.
 *
 * Works on any subset of a bracket's matches, which is what makes tiling (bracket-tiling.ts)
 * possible: a "late" tile's matches feed from matches that live on an earlier tile, and those show
 * up here as a "virtual leaf" (a starting node labeled by the earlier match's public code) rather
 * than a real participant slot — the same "Pemenang <code>" convention already used in the round
 * table, just drawn as a node instead of a table cell.
 */

export const ROW_HEIGHT = 22;
export const COL_WIDTH = 140;
export const LEAF_LABEL_WIDTH = 170;

export interface GeometryLeaf {
  readonly key: string;
  readonly y: number;
  readonly label: string;
  readonly sublabel: string | null;
  readonly isBye: boolean;
  /** True when this leaf stands in for a match rendered on a different tile, not a real participant slot. */
  readonly isVirtual: boolean;
  /** The underlying `ExportEntry.id`, for callers that need to join more participant fields; `null` for a BYE or virtual leaf. */
  readonly entryId: string | null;
}

export interface GeometryMatchNode {
  readonly match: ExportMatch;
  /** 1-based column within THIS geometry (not necessarily the bracket's global round number). */
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly feederAY: number;
  readonly feederBY: number;
  readonly prevX: number;
}

export interface BracketGeometry {
  readonly leaves: readonly GeometryLeaf[];
  readonly matches: readonly GeometryMatchNode[];
  readonly width: number;
  readonly height: number;
}

/**
 * Builds geometry for exactly the matches given (a full bracket, or one tile of a larger one).
 * `slots` supplies real participant/BYE data for any round-1-style (slot) feeder; a match-kind
 * feeder whose source match isn't in `matches` becomes a virtual "Pemenang <code>" leaf.
 */
export function computeBracketGeometry(
  matches: readonly ExportMatch[],
  slots: readonly ExportBracketSlot[],
): BracketGeometry {
  const matchByUid = new Map(matches.map((m) => [m.matchUid, m]));
  const slotByPos = new Map(slots.map((s) => [s.position, s]));
  const sorted = [...matches].sort((a, b) => a.round - b.round || a.position - b.position);
  const minRound = sorted.length > 0 ? Math.min(...sorted.map((m) => m.round)) : 1;

  const leaves: GeometryLeaf[] = [];
  const yByKey = new Map<string, number>();

  function registerLeaf(key: string, build: (y: number) => GeometryLeaf): number {
    const existing = yByKey.get(key);
    if (existing !== undefined) return existing;
    const y = leaves.length * ROW_HEIGHT;
    leaves.push(build(y));
    yByKey.set(key, y);
    return y;
  }

  function feederY(feeder: ExportMatch['feederA']): number {
    if (feeder.kind === 'slot') {
      const s = slotByPos.get(feeder.slot);
      return registerLeaf(`slot:${feeder.slot}`, (y) => ({
        key: `slot:${feeder.slot}`,
        y,
        label: s?.isBye ? 'BYE' : (s?.entry?.displayName ?? `Slot ${feeder.slot + 1}`),
        sublabel: s && !s.isBye ? (s.entry?.contingent ?? null) : null,
        isBye: s?.isBye ?? false,
        isVirtual: false,
        entryId: s && !s.isBye ? (s.entry?.id ?? null) : null,
      }));
    }
    if (matchByUid.has(feeder.matchUid)) {
      // Fed by a match that's also drawn on this tile — its y is computed when we process it below
      // (matches are processed in round order, so an earlier round's y is already known here).
      return yByKey.get(`match:${feeder.matchUid}`) ?? 0;
    }
    return registerLeaf(`match:${feeder.matchUid}`, (y) => ({
      key: `match:${feeder.matchUid}`,
      y,
      label: `Pemenang ${feeder.publicCode ?? '?'}`,
      sublabel: null,
      isBye: false,
      isVirtual: true,
      entryId: null,
    }));
  }

  const nodes: GeometryMatchNode[] = [];
  for (const m of sorted) {
    // A WALKOVER match (INV-04: `real: false`) is a bye pairing, not a contest -- the persisted engine
    // output still records it (one feeder is a bye slot) so the bracket's shape stays a clean power of
    // two internally, but nothing was ever "played" here. Drawing it as an ordinary boxed match would
    // show a fake empty slot merely to fill out the graphical bracket (PDF Presentation Remediation,
    // official bracket structure). Instead, the surviving (non-bye) feeder's own row simply becomes
    // what the next round sees as this match's result -- no leaf is registered for the bye side, and
    // no box/connector is drawn for this match at all, so the advancing participant's line runs
    // straight through to the match it actually plays.
    if (m.status === 'WALKOVER') {
      const byeSide =
        m.feederA.kind === 'slot' && slotByPos.get(m.feederA.slot)?.isBye ? m.feederA : m.feederB;
      const advancing = byeSide === m.feederA ? m.feederB : m.feederA;
      yByKey.set(`match:${m.matchUid}`, feederY(advancing));
      continue;
    }
    const ay = feederY(m.feederA);
    const by = feederY(m.feederB);
    const y = (ay + by) / 2;
    yByKey.set(`match:${m.matchUid}`, y);
    const column = m.round - minRound + 1;
    const x = LEAF_LABEL_WIDTH + column * COL_WIDTH;
    const prevX = LEAF_LABEL_WIDTH + (column - 1) * COL_WIDTH;
    nodes.push({ match: m, column, x, y, feederAY: ay, feederBY: by, prevX });
  }

  const maxColumn = nodes.reduce((max, n) => Math.max(max, n.column), 0);
  const width = LEAF_LABEL_WIDTH + (maxColumn + 1) * COL_WIDTH;
  const height = Math.max(leaves.length, 1) * ROW_HEIGHT + ROW_HEIGHT;
  return { leaves, matches: nodes, width, height };
}
