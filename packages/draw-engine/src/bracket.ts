import { compareNumbers, compareStrings, Prng, type DrawSeed } from '@bagantkd/shared';

import type { Reason } from './contract.js';

/**
 * Single-elimination brackets (INV-04). S = smallest power of two ≥ max(2, n); byes = S − n.
 * Ranks 1…S are laid out by standard seeding (rank r meets rank S+1−r in round 1, ranks 1 and 2
 * can only meet in the final); ranks above n are byes, so byes always face the top-ranked lines and
 * a bye never faces a bye. Manual seeds take their own rank (INV-08); the remaining entries are
 * placed on the remaining ranks to minimize same-contingent early meetings.
 */

export interface BracketEntry {
  readonly id: string;
  readonly contingent: string;
  /** Manual seed within this bracket (1 = top), or null. */
  readonly seedNo: number | null;
  /**
   * Belt rank (rule set's `rule_belt.rank`, lower = beginner), or null/absent when unresolvable.
   * Optional so every existing caller/fixture without belt data is unaffected: an entry with no
   * rank never contributes to `BELT_TOLERANCE_GAP` cost (see `beltToleranceCost`).
   */
  readonly beltRank?: number | null;
}

/**
 * How many belt ranks apart two entries may be and still meet without the pairing being flagged as
 * too wide a gap (team's own rule: green can only meet yellow/blue, i.e. 2 ranks either side).
 */
export const BELT_TOLERANCE = 2;

export interface BracketSlot {
  readonly position: number;
  readonly entryId: string | null;
  readonly seedNo: number | null;
  readonly byeReason: Reason | null;
}

export type Feeder = { readonly slot: number } | { readonly match: number };

export interface BracketMatch {
  readonly round: number;
  readonly position: number;
  readonly feederA: Feeder;
  readonly feederB: Feeder;
  /** False for a round-1 pairing of an entry with a bye (a walkover, not a contest). */
  readonly real: boolean;
}

export interface PlacementSearch {
  readonly method: 'EXHAUSTIVE' | 'HEURISTIC' | 'SEEDED_RANDOM';
  /** Permutations evaluated (exhaustive) or swaps evaluated (heuristic). */
  readonly evaluated: number;
  /** Same-contingent meetings per round, round 1 first, for the chosen placement. */
  readonly sameContingentByRound: readonly number[];
  /** Meetings per round pairing entries whose belt ranks differ by more than BELT_TOLERANCE. */
  readonly beltToleranceByRound: readonly number[];
}

export interface Bracket {
  readonly size: number;
  readonly rounds: number;
  readonly entries: number;
  readonly byes: number;
  readonly slots: readonly BracketSlot[];
  readonly matches: readonly BracketMatch[];
  readonly search: PlacementSearch;
}

export const nextPowerOfTwo = (n: number): number => {
  let s = 2;
  while (s < n) s *= 2;
  return s;
};

/** rankAt[position − 1] = seeding rank of that slot (standard layout). */
export function standardRanks(size: number): number[] {
  let cur = [1];
  for (let m = 2; m <= size; m *= 2) cur = cur.flatMap((r) => [r, m + 1 - r]);
  return cur;
}

/** Round in which slots a and b (1-based positions) can first meet. */
const meetingRound = (a: number, b: number): number => {
  let x = a - 1;
  let y = b - 1;
  let r = 0;
  while (x !== y) {
    x >>= 1;
    y >>= 1;
    r += 1;
  }
  return r;
};

/** Same-contingent meetings per round for a slot assignment (entry ids by position, null = bye). */
function contingentCost(byPosition: readonly (BracketEntry | null)[], rounds: number): number[] {
  const cost = new Array<number>(rounds).fill(0);
  for (let a = 0; a < byPosition.length; a += 1) {
    const ea = byPosition[a];
    if (!ea) continue;
    for (let b = a + 1; b < byPosition.length; b += 1) {
      const eb = byPosition[b];
      if (eb && eb.contingent === ea.contingent) {
        const r = meetingRound(a + 1, b + 1) - 1;
        cost[r] = (cost[r] ?? 0) + 1;
      }
    }
  }
  return cost;
}

/**
 * Same-idea as `contingentCost` but for belt-rank gaps (BELT_TOLERANCE_GAP): counts, per round, how
 * many meetings pair two entries whose belt ranks differ by more than `BELT_TOLERANCE`. An entry
 * with no resolvable belt rank (null/absent) never contributes -- pools without belt data behave
 * exactly as before this cost existed.
 *
 * This is a SECONDARY objective, applied only as a tie-breaker after contingent separation
 * (`contingentCost`) in `combinedCost` below: it never moves an entry into a worse-contingent
 * placement just to close a belt gap. Within a pool small enough that contingent separation is a
 * tie (e.g. every entry from a different contingent, as in the team's own 2×Geup8 + 2×Geup3
 * example), this is what decides round-1 pairings.
 */
function beltToleranceCost(byPosition: readonly (BracketEntry | null)[], rounds: number): number[] {
  const cost = new Array<number>(rounds).fill(0);
  for (let a = 0; a < byPosition.length; a += 1) {
    const ea = byPosition[a];
    const rankA = ea?.beltRank;
    if (ea == null || rankA == null) continue;
    for (let b = a + 1; b < byPosition.length; b += 1) {
      const eb = byPosition[b];
      const rankB = eb?.beltRank;
      if (eb == null || rankB == null) continue;
      if (Math.abs(rankA - rankB) > BELT_TOLERANCE) {
        const r = meetingRound(a + 1, b + 1) - 1;
        cost[r] = (cost[r] ?? 0) + 1;
      }
    }
  }
  return cost;
}

const lexCompare = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i += 1) {
    const c = compareNumbers(a[i] ?? 0, b[i] ?? 0);
    if (c !== 0) return c;
  }
  return 0;
};

export const EXHAUSTIVE_PLACEMENT_MAX = 8;

export interface BuildBracketArgs {
  readonly entries: readonly BracketEntry[];
  readonly seed: DrawSeed;
  /** Stable label for the random stream (category and pool). */
  readonly label: string;
  readonly byePolicy: string;
  /** Swap evaluations allowed per entry for the n > 8 heuristic. */
  readonly budgetPerEntry: number;
  /** Largest number of unseeded entries placed exhaustively (default 8; tests lower it to compare). */
  readonly exhaustiveMax?: number;
}

export function buildBracket(args: BuildBracketArgs): Bracket {
  const n = args.entries.length;
  if (n < 1) throw new Error('BRACKET_EMPTY');
  const size = nextPowerOfTwo(Math.max(2, n));
  const rounds = Math.log2(size);
  const byes = size - n;
  const rankAt = standardRanks(size);
  const positionOfRank = new Map(rankAt.map((r, i) => [r, i + 1]));

  // Manual seeds keep their rank; they must be distinct and within 1…n.
  const seeded = args.entries.filter((e) => e.seedNo !== null);
  const seedRanks = new Set(seeded.map((e) => e.seedNo));
  if (seedRanks.size !== seeded.length || seeded.some((e) => (e.seedNo ?? 0) < 1 || (e.seedNo ?? 0) > n)) {
    throw new Error('BRACKET_SEED_INVALID');
  }
  const freeRanks = Array.from({ length: n }, (_, i) => i + 1).filter((r) => !seedRanks.has(r));
  // Seeded random order of the unseeded entries: the only source of randomness, it breaks ties.
  const rng = Prng.fromSeed(args.seed, `bracket/${args.label}`);
  const unseeded = rng.shuffled(
    [...args.entries.filter((e) => e.seedNo === null)].sort((a, b) => compareStrings(a.id, b.id)),
  );

  const layout = (assignment: readonly BracketEntry[]): (BracketEntry | null)[] => {
    const byPosition: (BracketEntry | null)[] = new Array<BracketEntry | null>(size).fill(null);
    for (const e of seeded) byPosition[(positionOfRank.get(e.seedNo ?? 0) ?? 0) - 1] = e;
    assignment.forEach((e, i) => {
      byPosition[(positionOfRank.get(freeRanks[i] ?? 0) ?? 0) - 1] = e;
    });
    return byPosition;
  };

  // Contingent separation is the primary objective (unchanged from before belt tolerance existed);
  // belt-gap avoidance is appended as a secondary tie-breaker so it only decides between placements
  // that are already equally good for contingent separation -- it can never make same-contingent
  // meetings worse in order to close a belt gap.
  const combinedCost = (assignment: readonly BracketEntry[]): number[] => {
    const lay = layout(assignment);
    return [...contingentCost(lay, rounds), ...beltToleranceCost(lay, rounds)];
  };

  let best: BracketEntry[] = unseeded;
  let bestCombined = combinedCost(best);
  let evaluated = 1;
  let method: PlacementSearch['method'];
  const contingentAware = args.byePolicy !== 'RANDOM_SEEDED';

  if (!contingentAware) {
    method = 'SEEDED_RANDOM';
  } else if (unseeded.length <= (args.exhaustiveMax ?? EXHAUSTIVE_PLACEMENT_MAX)) {
    // Exhaustive over the explicit search space: every assignment of the unseeded entries to the
    // free ranks (byes fixed opposite the top ranks). Heap's algorithm in the seeded order; the
    // first minimum found is kept.
    method = 'EXHAUSTIVE';
    const a = [...unseeded];
    const c = new Array<number>(a.length).fill(0);
    let i = 0;
    while (i < a.length) {
      if ((c[i] ?? 0) < i) {
        const j = i % 2 === 0 ? 0 : (c[i] ?? 0);
        [a[j], a[i]] = [a[i] as BracketEntry, a[j] as BracketEntry];
        evaluated += 1;
        const cost = combinedCost(a);
        if (lexCompare(cost, bestCombined) < 0) {
          best = [...a];
          bestCombined = cost;
        }
        c[i] = (c[i] ?? 0) + 1;
        i = 0;
      } else {
        c[i] = 0;
        i += 1;
      }
    }
  } else {
    // Greedy by rank (consecutive ranks lie in different halves), then first-improvement swaps.
    // Costs are updated incrementally: only meetings involving the placed or swapped entries change.
    method = 'HEURISTIC';
    const positions = freeRanks.map((r) => (positionOfRank.get(r) ?? 0) - 1);
    const byPos: (BracketEntry | null)[] = layout([]);
    /** Same-contingent meetings of `e` at position `pos` with everyone else on the board. */
    const contrib = (pos: number, e: BracketEntry, skip: ReadonlySet<number>): number[] => {
      const c = new Array<number>(rounds).fill(0);
      for (let q = 0; q < size; q += 1) {
        if (q === pos || skip.has(q)) continue;
        const o = byPos[q];
        if (o && o.contingent === e.contingent) {
          const r = meetingRound(pos + 1, q + 1) - 1;
          c[r] = (c[r] ?? 0) + 1;
        }
      }
      return c;
    };
    /** Belt-gap meetings of `e` at position `pos` with everyone else on the board (see beltToleranceCost). */
    const beltContrib = (pos: number, e: BracketEntry, skip: ReadonlySet<number>): number[] => {
      const c = new Array<number>(rounds).fill(0);
      const rankE = e.beltRank;
      if (rankE == null) return c;
      for (let q = 0; q < size; q += 1) {
        if (q === pos || skip.has(q)) continue;
        const o = byPos[q];
        const rankO = o?.beltRank;
        if (o && rankO != null && Math.abs(rankO - rankE) > BELT_TOLERANCE) {
          const r = meetingRound(pos + 1, q + 1) - 1;
          c[r] = (c[r] ?? 0) + 1;
        }
      }
      return c;
    };
    const combinedContrib = (pos: number, e: BracketEntry, skip: ReadonlySet<number>): number[] => [
      ...contrib(pos, e, skip),
      ...beltContrib(pos, e, skip),
    ];
    const remaining = [...unseeded];
    const placed: BracketEntry[] = [];
    for (let k = 0; k < unseeded.length; k += 1) {
      const pos = positions[k] ?? 0;
      let pick = 0;
      let pickCost: number[] | null = null;
      // Entries sharing both contingent and belt rank are interchangeable for the cost: evaluate
      // the first of each (contingent alone is no longer enough now that belt rank also matters).
      const seen = new Set<string>();
      for (let x = 0; x < remaining.length; x += 1) {
        const e = remaining[x] as BracketEntry;
        const key = `${e.contingent}\u0000${e.beltRank ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        evaluated += 1;
        const cost = combinedContrib(pos, e, new Set());
        if (!pickCost || lexCompare(cost, pickCost) < 0) {
          pick = x;
          pickCost = cost;
        }
      }
      const e = remaining.splice(pick, 1)[0] as BracketEntry;
      placed.push(e);
      byPos[pos] = e;
    }
    const budget = evaluated + args.budgetPerEntry * n;
    let improved = true;
    while (improved && evaluated < budget) {
      improved = false;
      for (let x = 0; x < placed.length && !improved && evaluated < budget; x += 1) {
        for (let y = x + 1; y < placed.length && evaluated < budget; y += 1) {
          const ex = placed[x] as BracketEntry;
          const ey = placed[y] as BracketEntry;
          if (ex.contingent === ey.contingent && (ex.beltRank ?? null) === (ey.beltRank ?? null)) continue;
          evaluated += 1;
          const px = positions[x] ?? 0;
          const py = positions[y] ?? 0;
          const skip = new Set([px, py]);
          const before = combinedContrib(px, ex, skip).map(
            (v, i) => v + (combinedContrib(py, ey, skip)[i] ?? 0),
          );
          const after = combinedContrib(px, ey, skip).map(
            (v, i) => v + (combinedContrib(py, ex, skip)[i] ?? 0),
          );
          if (lexCompare(after, before) < 0) {
            placed[x] = ey;
            placed[y] = ex;
            byPos[px] = ey;
            byPos[py] = ex;
            improved = true;
            break;
          }
        }
      }
    }
    best = placed;
  }

  const byPosition = layout(best);
  const rankReason = contingentAware ? 'CONTINGENT_SEPARATION' : 'SEEDED_DRAW';
  const slots: BracketSlot[] = byPosition.map((e, i) => {
    const position = i + 1;
    if (e) return { position, entryId: e.id, seedNo: e.seedNo, byeReason: null };
    const oppositeRank = size + 1 - (rankAt[i] ?? 0);
    const opposite = byPosition[(positionOfRank.get(oppositeRank) ?? 0) - 1] ?? null;
    return {
      position,
      entryId: null,
      seedNo: null,
      byeReason: {
        code: opposite?.seedNo != null ? 'BYE_TO_MANUAL_SEED' : 'BYE_TO_TOP_RANK',
        params: {
          bracketSize: size,
          entries: n,
          byes,
          oppositeRank,
          oppositeEntry: opposite?.id ?? null,
          oppositeSeedNo: opposite?.seedNo ?? null,
          rankAssignedBy: opposite?.seedNo != null ? 'MANUAL_SEED' : rankReason,
          byePolicy: args.byePolicy,
        },
      },
    };
  });

  const matches: BracketMatch[] = [];
  for (let p = 1; p <= size / 2; p += 1) {
    matches.push({
      round: 1,
      position: p,
      feederA: { slot: 2 * p - 1 },
      feederB: { slot: 2 * p },
      real: byPosition[2 * p - 2] !== null && byPosition[2 * p - 1] !== null,
    });
  }
  for (let r = 2; r <= rounds; r += 1) {
    for (let p = 1; p <= size / 2 ** r; p += 1) {
      matches.push({
        round: r,
        position: p,
        feederA: { match: 2 * p - 1 },
        feederB: { match: 2 * p },
        real: true,
      });
    }
  }
  return {
    size,
    rounds,
    entries: n,
    byes,
    slots,
    matches,
    search: {
      method,
      evaluated,
      sameContingentByRound: contingentCost(byPosition, rounds),
      beltToleranceByRound: beltToleranceCost(byPosition, rounds),
    },
  };
}

export interface BracketViolation {
  readonly code: string;
  readonly detail: string;
}

/** INV-04 (and INV-08 for manual seeds) for one bracket against its expected entries. */
export function checkBracket(b: Bracket, expected: readonly BracketEntry[]): BracketViolation[] {
  const v: BracketViolation[] = [];
  const add = (code: string, detail = '') => v.push({ code, detail });
  const n = expected.length;
  if (b.size < 2 || (b.size & (b.size - 1)) !== 0) add('SIZE_NOT_POWER_OF_TWO', String(b.size));
  if (b.size !== nextPowerOfTwo(Math.max(2, n))) add('SIZE_NOT_MINIMAL', String(b.size));
  if (2 ** b.rounds !== b.size) add('ROUNDS_MISMATCH');
  if (b.entries !== n || b.byes !== b.size - n) add('BYE_COUNT', `${b.byes}`);
  if (b.slots.length !== b.size) add('SLOT_COUNT');
  const ids = b.slots.map((s) => s.entryId).filter((x): x is string => x !== null);
  if (new Set(ids).size !== ids.length) add('DUPLICATE_ENTRY');
  const exp = new Set(expected.map((e) => e.id));
  for (const id of ids) if (!exp.has(id)) add('UNEXPECTED_ENTRY', id);
  for (const id of exp) if (!ids.includes(id)) add('MISSING_ENTRY', id);
  if (b.slots.filter((s) => s.entryId === null).length !== b.byes) add('BYE_SLOT_COUNT');
  for (const s of b.slots)
    if (s.entryId === null && s.byeReason === null) add('BYE_WITHOUT_REASON', String(s.position));
  for (let p = 0; p < b.size; p += 2) {
    if (b.slots[p]?.entryId === null && b.slots[p + 1]?.entryId === null) add('BYE_VS_BYE', String(p + 1));
  }
  // Halves balanced at every level.
  for (let block = b.size; block >= 2; block /= 2) {
    for (let start = 0; start < b.size; start += block) {
      const count = (from: number, to: number) =>
        b.slots.slice(from, to).filter((s) => s.entryId !== null).length;
      const half = block / 2;
      if (Math.abs(count(start, start + half) - count(start + half, start + block)) > 1)
        add('HALVES_UNBALANCED', `${start + 1}/${block}`);
    }
  }
  const real = b.matches.filter((m) => m.real).length;
  if (real !== Math.max(0, n - 1)) add('REAL_MATCH_COUNT', `${real}`);
  const finals = b.matches.filter((m) => m.round === b.rounds);
  if (finals.length !== 1) add('FINAL_COUNT', `${finals.length}`);
  // Progression: every match of round r > 1 is fed by matches 2p−1 and 2p of round r − 1.
  const exists = new Set(b.matches.map((m) => `${m.round}/${m.position}`));
  for (const m of b.matches) {
    if (m.round === 1) {
      if (
        !('slot' in m.feederA) ||
        !('slot' in m.feederB) ||
        m.feederA.slot !== 2 * m.position - 1 ||
        m.feederB.slot !== 2 * m.position
      )
        add('ROUND1_FEEDER', `${m.position}`);
    } else if (
      !('match' in m.feederA) ||
      !('match' in m.feederB) ||
      !exists.has(`${m.round - 1}/${m.feederA.match}`) ||
      !exists.has(`${m.round - 1}/${m.feederB.match}`) ||
      m.feederA.match !== 2 * m.position - 1 ||
      m.feederB.match !== 2 * m.position
    ) {
      add('PROGRESSION', `${m.round}/${m.position}`);
    }
  }
  if (b.matches.length !== b.size - 1) add('MATCH_COUNT', `${b.matches.length}`);
  // INV-08: a manual seed occupies the standard slot of its rank.
  const rankAt = standardRanks(b.size);
  for (const e of expected) {
    if (e.seedNo === null) continue;
    const slot = b.slots.find((s) => s.entryId === e.id);
    if (!slot || rankAt[slot.position - 1] !== e.seedNo) add('MANUAL_SEED_MOVED', e.id);
  }
  return v;
}
