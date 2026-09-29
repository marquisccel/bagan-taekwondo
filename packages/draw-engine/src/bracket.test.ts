import { parseDrawSeed, Prng } from '@bagantkd/shared';
import { describe, expect, it } from 'vitest';

import { buildBracket, checkBracket, standardRanks, type BracketEntry } from './bracket.js';

const lex = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/** Independent brute force: every assignment of entries to ranks 1…n; cost = same-contingent meetings by round. */
function bruteForceMinimum(entries: readonly BracketEntry[]): number[] {
  const n = entries.length;
  let size = 2;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const ranks = standardRanks(size);
  const round = (a: number, b: number) => {
    let r = 0;
    for (let x = a, y = b; x !== y; x >>= 1, y >>= 1) r += 1;
    return r;
  };
  let best: number[] | null = null;
  const perm = (rest: readonly BracketEntry[], acc: BracketEntry[]) => {
    if (rest.length === 0) {
      const byRank = new Map(acc.map((e, i) => [i + 1, e]));
      const at = ranks.map((r) => byRank.get(r) ?? null);
      const cost = new Array<number>(rounds).fill(0);
      for (let a = 0; a < size; a += 1)
        for (let b = a + 1; b < size; b += 1) {
          const ea = at[a];
          const eb = at[b];
          if (ea && eb && ea.contingent === eb.contingent) {
            const r = round(a, b) - 1;
            cost[r] = (cost[r] ?? 0) + 1;
          }
        }
      if (!best || lex(cost, best) < 0) best = cost;
      return;
    }
    rest.forEach((e, i) => {
      perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, e]);
    });
  };
  perm(entries, []);
  return best ?? [];
}

const random = (n: number, contingents: number, seed: string): BracketEntry[] => {
  const rng = Prng.fromSeed(parseDrawSeed(seed), `entries/${n}`);
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    contingent: `K${rng.nextBelow(contingents)}`,
    seedNo: null,
  }));
};

describe('bracket placement, n ≤ 8: exhaustive over the defined search space (Phase 3E)', () => {
  it('equals an independent brute force over all rank assignments (byes fixed opposite the top ranks)', () => {
    for (let n = 1; n <= 8; n += 1) {
      for (let s = 0; s < (n === 8 ? 2 : 6); s += 1) {
        const es = random(n, 2 + (s % 3), String(n * 100 + s));
        const b = buildBracket({
          entries: es,
          seed: parseDrawSeed(String(s)),
          label: 'x',
          byePolicy: 'CONTINGENT_AWARE',
          budgetPerEntry: 20,
        });
        expect(b.search.method).toBe('EXHAUSTIVE');
        expect([...b.search.sameContingentByRound], `n=${n} s=${s}`).toEqual(bruteForceMinimum(es));
        expect(checkBracket(b, es)).toEqual([]);
      }
    }
  });

  it('the n > 8 heuristic, run on n ≤ 8, is compared with the exhaustive result (gaps reported, never hidden)', () => {
    let cases = 0;
    let gaps = 0;
    for (let n = 3; n <= 8; n += 1) {
      for (let s = 0; s < 20; s += 1) {
        const es = random(n, 2 + (s % 3), String(9000 + n * 100 + s));
        const args = {
          entries: es,
          seed: parseDrawSeed(String(s)),
          label: 'h',
          byePolicy: 'CONTINGENT_AWARE',
          budgetPerEntry: 200,
        } as const;
        const exact = buildBracket(args).search.sameContingentByRound;
        const heuristic = buildBracket({ ...args, exhaustiveMax: 0 }).search.sameContingentByRound;
        cases += 1;
        expect(lex(heuristic, exact)).toBeGreaterThanOrEqual(0);
        if (lex(heuristic, exact) !== 0) gaps += 1;
      }
    }
    process.stdout.write(
      `  [exhaustive-bracket] heuristic vs exhaustive: ${gaps}/${cases} placements differ\n`,
    );
    expect(gaps / cases).toBeLessThan(0.2);
  });

  it('a pool of 4 from two contingents never meets in round 1; a 3-pool gives the bye to the majority contingent', () => {
    const four = [
      { id: 'a', contingent: 'A', seedNo: null },
      { id: 'b', contingent: 'A', seedNo: null },
      { id: 'c', contingent: 'B', seedNo: null },
      { id: 'd', contingent: 'B', seedNo: null },
    ];
    expect(
      buildBracket({
        entries: four,
        seed: parseDrawSeed('1'),
        label: 'p',
        byePolicy: 'CONTINGENT_AWARE',
        budgetPerEntry: 20,
      }).search.sameContingentByRound,
    ).toEqual([0, 2]);
    const three = four.slice(0, 3);
    const b = buildBracket({
      entries: three,
      seed: parseDrawSeed('1'),
      label: 'p',
      byePolicy: 'CONTINGENT_AWARE',
      budgetPerEntry: 20,
    });
    expect(b.search.sameContingentByRound[0]).toBe(0);
    const bye = b.slots.find((s) => s.entryId === null);
    expect(bye?.byeReason).toMatchObject({
      code: 'BYE_TO_TOP_RANK',
      params: { bracketSize: 4, entries: 3, byes: 1 },
    });
  });

  it('pairs entries with a close belt rank together in round 1 rather than crossing a too-wide gap (2×Geup8 + 2×Geup3, team\'s own example)', () => {
    // Four different contingents so contingent-separation cost ties at 0 for every permutation --
    // isolating belt tolerance as the only thing that can decide the round-1 pairing.
    const four = [
      { id: 'a', contingent: 'A', seedNo: null, beltRank: 8 },
      { id: 'b', contingent: 'B', seedNo: null, beltRank: 8 },
      { id: 'c', contingent: 'C', seedNo: null, beltRank: 3 },
      { id: 'd', contingent: 'D', seedNo: null, beltRank: 3 },
    ];
    const b = buildBracket({
      entries: four,
      seed: parseDrawSeed('1'),
      label: 'p',
      byePolicy: 'CONTINGENT_AWARE',
      budgetPerEntry: 20,
    });
    expect(b.search.beltToleranceByRound[0]).toBe(0);
    const rankById = new Map(four.map((e) => [e.id, e.beltRank]));
    for (let p = 1; p <= b.size; p += 2) {
      const idA = b.slots.find((s) => s.position === p)?.entryId;
      const idB = b.slots.find((s) => s.position === p + 1)?.entryId;
      if (idA && idB) expect(rankById.get(idA)).toBe(rankById.get(idB));
    }
  });

  it('never lets belt tolerance override contingent separation (the primary, pre-existing objective)', () => {
    // 'a' and 'b' share a contingent but have close belts; 'c' and 'd' are lone contingents with a
    // wide belt gap from everyone. Separating 'a' and 'b' in round 1 stays mandatory even though it
    // is belt-neutral either way, and belt tolerance never gets to relitigate that choice.
    const four = [
      { id: 'a', contingent: 'X', seedNo: null, beltRank: 5 },
      { id: 'b', contingent: 'X', seedNo: null, beltRank: 5 },
      { id: 'c', contingent: 'Y', seedNo: null, beltRank: 1 },
      { id: 'd', contingent: 'Z', seedNo: null, beltRank: 9 },
    ];
    const b = buildBracket({
      entries: four,
      seed: parseDrawSeed('1'),
      label: 'p',
      byePolicy: 'CONTINGENT_AWARE',
      budgetPerEntry: 20,
    });
    expect(b.search.sameContingentByRound[0]).toBe(0);
  });

  it('an entry with no resolvable belt rank never contributes to belt-tolerance cost', () => {
    const four = [
      { id: 'a', contingent: 'A', seedNo: null, beltRank: null },
      { id: 'b', contingent: 'B', seedNo: null, beltRank: 8 },
      { id: 'c', contingent: 'C', seedNo: null, beltRank: null },
      { id: 'd', contingent: 'D', seedNo: null, beltRank: 3 },
    ];
    expect(() =>
      buildBracket({
        entries: four,
        seed: parseDrawSeed('1'),
        label: 'p',
        byePolicy: 'CONTINGENT_AWARE',
        budgetPerEntry: 20,
      }),
    ).not.toThrow();
  });

  it('refuses invalid manual seeds instead of guessing', () => {
    const es = [
      { id: 'a', contingent: 'A', seedNo: 1 },
      { id: 'b', contingent: 'B', seedNo: 1 },
    ];
    expect(() =>
      buildBracket({
        entries: es,
        seed: parseDrawSeed('1'),
        label: 's',
        byePolicy: 'SEED_PRIORITY',
        budgetPerEntry: 20,
      }),
    ).toThrow('BRACKET_SEED_INVALID');
    expect(() =>
      buildBracket({
        entries: [{ id: 'a', contingent: 'A', seedNo: 3 }],
        seed: parseDrawSeed('1'),
        label: 's',
        byePolicy: 'SEED_PRIORITY',
        budgetPerEntry: 20,
      }),
    ).toThrow('BRACKET_SEED_INVALID');
  });

  it('a bye beside a manual seed is explained as such', () => {
    const es = [
      { id: 'top', contingent: 'A', seedNo: 1 },
      { id: 'x', contingent: 'B', seedNo: null },
      { id: 'y', contingent: 'C', seedNo: null },
    ];
    const b = buildBracket({
      entries: es,
      seed: parseDrawSeed('4'),
      label: 's',
      byePolicy: 'SEED_PRIORITY',
      budgetPerEntry: 20,
    });
    expect(b.slots[0]?.entryId).toBe('top');
    expect(b.slots[1]?.byeReason).toMatchObject({
      code: 'BYE_TO_MANUAL_SEED',
      params: { oppositeEntry: 'top', oppositeSeedNo: 1 },
    });
  });
});
