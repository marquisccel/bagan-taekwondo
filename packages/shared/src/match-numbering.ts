/**
 * The printed match number the team sees ("No." on the web bracket, and the number printed on the
 * exported PDF) — always the SAME resolution in both places, since a number that doesn't match
 * between screen and paper is worse than no number at all.
 *
 * A number the team typed manually (`match.display_no`, presentation-only — see
 * packages/db/src/schema/draw.ts) is authoritative and never displaced. Every other match gets the
 * next unused positive integer, walked in the caller's own canonical reading order (category, then
 * pool, then round, then position) so a fresh draw with no manual numbers yet reads top-to-bottom as
 * 1, 2, 3, ... -- "auto-numbered until the team overrides it", not "blank until someone types
 * something". Recomputed fresh every time (never persisted), so if a pool's composition changes
 * (an entry moved or swapped, producing new match rows), the automatic numbers for every
 * still-unedited match simply recompute in the new order; only entries the team explicitly pinned a
 * number to stay exactly where they were pinned.
 */
export interface MatchNumberInput {
  readonly id: string;
  readonly displayNo: number | null;
  /** Canonical reading order key (e.g. [categoryIndex, poolOrdinal, round, position]) — smaller sorts first. */
  readonly order: readonly number[];
}

function compareOrder(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function resolveMatchNumbers(matches: readonly MatchNumberInput[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const m of matches) {
    if (m.displayNo !== null) {
      result.set(m.id, m.displayNo);
      used.add(m.displayNo);
    }
  }
  const unnumbered = matches.filter((m) => m.displayNo === null).sort((a, b) => compareOrder(a.order, b.order));
  let next = 1;
  for (const m of unnumbered) {
    while (used.has(next)) next += 1;
    result.set(m.id, next);
    used.add(next);
    next += 1;
  }
  return result;
}
