import { describe, expect, it } from 'vitest';

import type { ExportBracket } from '../model.js';
import { makeFixtureModel } from '../testing/fixtures.js';
import { documentMatchNumbers } from './compact-bracket-svg.js';

/** `makeFixtureModel` restarts its own matchUid counter ("m0", "m1", ...) every call, so two
 * independently-built fixture brackets collide on matchUid -- never true in production (real
 * matchUids are globally unique deterministic UUIDs). Prefixing keeps this test's two brackets
 * distinct without changing anything `documentMatchNumbers` itself does. */
function withUniquePrefix(bracket: ExportBracket, prefix: string): ExportBracket {
  const rename = (uid: string) => `${prefix}${uid}`;
  return {
    ...bracket,
    matches: bracket.matches.map((m) => ({
      ...m,
      id: rename(m.id),
      matchUid: rename(m.matchUid),
      feederA: m.feederA.kind === 'match' ? { ...m.feederA, matchUid: rename(m.feederA.matchUid) } : m.feederA,
      feederB: m.feederB.kind === 'match' ? { ...m.feederB, matchUid: rename(m.feederB.matchUid) } : m.feederB,
    })),
  };
}

function bracketFor(n: number, prefix: string) {
  const model = makeFixtureModel({ participantCount: n });
  const bracket = model.categories[0]?.pools[0]?.bracket;
  if (!bracket) throw new Error('fixture has no bracket');
  return withUniquePrefix(bracket, prefix);
}

const pool = (id: string, bracket: ExportBracket | null) => ({ id, bracket });

describe('documentMatchNumbers', () => {
  it('numbers every drawn match 1, 2, 3, ... across pools in the order given, when nothing is manually pinned', () => {
    const a = bracketFor(4, 'A-'); // 3 matches
    const b = bracketFor(2, 'B-'); // 1 match
    const numbers = documentMatchNumbers([pool('pa', a), pool('pb', b)]);
    const aNums = a.matches.map((m) => numbers.get(m.matchUid)).sort((x, y) => (x ?? 0) - (y ?? 0));
    const bNums = b.matches.map((m) => numbers.get(m.matchUid));
    expect(aNums).toEqual([1, 2, 3]);
    expect(bNums).toEqual([4]);
  });

  it('never displaces a match number the team already pinned on screen (ExportMatch.displayNo) -- every other match fills around it', () => {
    const a = bracketFor(4, 'A-');
    const pinnedMatch = a.matches.find((m) => m.round === 1);
    if (!pinnedMatch) throw new Error('fixture has no round-1 match');
    const pinned = { ...a, matches: a.matches.map((m) => (m.id === pinnedMatch.id ? { ...m, displayNo: 99 } : m)) };
    const b = bracketFor(2, 'B-');

    const numbers = documentMatchNumbers([pool('pa', pinned), pool('pb', b)]);
    expect(numbers.get(pinnedMatch.matchUid)).toBe(99);
    const others = [...pinned.matches.filter((m) => m.id !== pinnedMatch.id), ...b.matches].map(
      (m) => numbers.get(m.matchUid),
    );
    // 3 other matches total (2 remaining in `a`, 1 in `b`), filling 1, 2, 3 -- never reusing 99.
    expect([...others].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([1, 2, 3]);
  });

  it('a bracket too large for the compact card contributes no numbers, and does not shift later pools\' numbers', () => {
    const tooLarge = bracketFor(64, 'C-');
    const small = bracketFor(2, 'B-');
    const numbers = documentMatchNumbers([pool('pc', tooLarge), pool('pb', small)]);
    for (const m of tooLarge.matches) expect(numbers.has(m.matchUid)).toBe(false);
    expect(numbers.get(small.matches[0]!.matchUid)).toBe(1);
  });

  it('a pool with no bracket at all (a lone walkover entry) still takes exactly one number, keyed by the pool id -- matching the committee\'s own SPS sheet, which numbers a lone entry too', () => {
    const a = bracketFor(4, 'A-'); // 3 matches: 1, 2, 3
    const numbers = documentMatchNumbers([pool('pa', a), pool('walkover-pool', null), pool('pb', bracketFor(2, 'B-'))]);
    expect(numbers.get('walkover-pool')).toBe(4);
    expect([...a.matches.map((m) => numbers.get(m.matchUid))].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([
      1, 2, 3,
    ]);
  });

  it('a pool whose bracket EXISTS but draws nothing (a real 1-entry-plus-bye bracket, persisted as size 2 with a single WALKOVER match -- CHELO QUEEN GADIZA P\'s real shape) still takes one number, exactly like a null bracket', () => {
    // A real 1-participant pool is NOT persisted as `bracket: null` -- it's a size-2 bracket with
    // one bye slot and one WALKOVER match, so `bracket.matches.length === 0` alone never catches
    // it (length is 1, not 0). This exact shape was the actual production bug: the lone entry got
    // no number at all until `documentMatchNumbers` also checked whether anything survived
    // computeBracketGeometry's WALKOVER-collapsing, not just whether `matches` was non-empty.
    const lone: ExportBracket = {
      id: 'b-lone',
      size: 2,
      rounds: 1,
      entries: 1,
      byes: 1,
      slots: [
        {
          position: 1,
          seedNo: null,
          isBye: false,
          entry: { id: 'e-lone', externalRef: 'X1', displayName: 'Lone Entry', contingent: 'C', athletes: [] },
        },
        { position: 2, seedNo: null, isBye: true, entry: null },
      ],
      matches: [
        {
          id: 'm-lone',
          matchUid: 'D-m-lone',
          publicCode: null,
          round: 1,
          position: 1,
          status: 'WALKOVER',
          displayNo: null,
          resolvedDisplayNo: null,
          feederA: { kind: 'slot', slot: 1 },
          feederB: { kind: 'slot', slot: 2 },
        },
      ],
    };
    const a = bracketFor(4, 'A-'); // 3 matches: 1, 2, 3
    const numbers = documentMatchNumbers([pool('pa', a), pool('lone-pool', lone)]);
    expect(numbers.get('lone-pool')).toBe(4);
    for (const m of lone.matches) expect(numbers.has(m.matchUid)).toBe(false);
  });
});
