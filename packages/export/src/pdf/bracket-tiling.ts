import type { ExportBracket, ExportBracketSlot, ExportMatch } from '../model.js';

/**
 * Deterministic tiling for large brackets (ACCEPTANCE §5) — never one unreadable page, never a
 * recomputation of the bracket. A bracket bigger than `tileLeaves` is split into contiguous
 * participant-range tiles (each a self-contained sub-bracket that converges to one "chunk
 * champion"), plus one trailing tile for the remaining later rounds, where those chunk champions
 * become "Pemenang <code>" leaves — the exact same convention the round table already uses for an
 * unresolved feeder.
 *
 * Chunk membership is derived from each match's real leaf span (which original slot positions it
 * ultimately traces back to, via the actual persisted feeder graph) — never from an assumed
 * numbering convention — so this is correct regardless of how the engine assigns `position`.
 */
export interface BracketTile {
  readonly label: string;
  readonly matches: readonly ExportMatch[];
  readonly slots: readonly ExportBracketSlot[];
}

interface Span {
  readonly min: number;
  readonly max: number;
}

function computeLeafSpans(bracket: ExportBracket): ReadonlyMap<string, Span> {
  const byUid = new Map(bracket.matches.map((m) => [m.matchUid, m]));
  const spanByUid = new Map<string, Span>();

  function feederMatch(matchUid: string): ExportMatch {
    const m = byUid.get(matchUid);
    if (!m) throw new Error(`bracket feeder references unknown match ${matchUid}`);
    return m;
  }

  function spanOf(m: ExportMatch): Span {
    const cached = spanByUid.get(m.matchUid);
    if (cached) return cached;
    const a =
      m.feederA.kind === 'slot'
        ? { min: m.feederA.slot, max: m.feederA.slot }
        : spanOf(feederMatch(m.feederA.matchUid));
    const b =
      m.feederB.kind === 'slot'
        ? { min: m.feederB.slot, max: m.feederB.slot }
        : spanOf(feederMatch(m.feederB.matchUid));
    const span: Span = { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
    spanByUid.set(m.matchUid, span);
    return span;
  }

  for (const m of [...bracket.matches].sort((x, y) => x.round - y.round)) spanOf(m);
  return spanByUid;
}

export function tileBracketMatches(bracket: ExportBracket, tileLeaves = 32): readonly BracketTile[] {
  if (bracket.size <= tileLeaves || bracket.matches.length === 0) {
    return [{ label: '', matches: bracket.matches, slots: bracket.slots }];
  }

  const spans = computeLeafSpans(bracket);
  const numChunks = Math.ceil(bracket.size / tileLeaves);
  const earlyTiles: BracketTile[] = [];
  const usedMatchUids = new Set<string>();

  for (let c = 0; c < numChunks; c++) {
    const start = c * tileLeaves;
    const end = Math.min((c + 1) * tileLeaves - 1, bracket.size - 1);
    const slots = bracket.slots.filter((s) => s.position >= start && s.position <= end);
    const matches = bracket.matches.filter((m) => {
      const span = spans.get(m.matchUid);
      return span !== undefined && span.min >= start && span.max <= end;
    });
    for (const m of matches) usedMatchUids.add(m.matchUid);
    earlyTiles.push({ label: `Slot ${start + 1}–${end + 1}`, matches, slots });
  }

  const lateMatches = bracket.matches.filter((m) => !usedMatchUids.has(m.matchUid));
  const tiles = [...earlyTiles];
  if (lateMatches.length > 0) {
    tiles.push({ label: 'Babak Lanjutan', matches: lateMatches, slots: [] });
  }
  return tiles;
}
