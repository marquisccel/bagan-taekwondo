import { describe, expect, it } from 'vitest';

import { makeFixtureModel } from '../testing/fixtures.js';
import { tileBracketMatches } from './bracket-tiling.js';

function bracketFor(n: number) {
  const model = makeFixtureModel({ participantCount: n });
  const bracket = model.categories[0]?.pools[0]?.bracket;
  if (!bracket) throw new Error('fixture has no bracket');
  return bracket;
}

describe('tileBracketMatches (large bracket pagination — ACCEPTANCE §5)', () => {
  it('does not tile a bracket at or below the tile threshold', () => {
    for (const n of [8, 16, 32]) {
      const tiles = tileBracketMatches(bracketFor(n));
      expect(tiles).toHaveLength(1);
      expect(tiles[0]?.matches).toHaveLength(bracketFor(n).matches.length);
    }
  });

  it('tiles a 64-entry bracket into early participant-range tiles plus one later-rounds tile', () => {
    const tiles = tileBracketMatches(bracketFor(64));
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.at(-1)?.label).toBe('Babak Lanjutan');
  });

  it('tiles a 128-entry bracket deterministically and loses no match', () => {
    const bracket = bracketFor(128);
    const [a, b] = [tileBracketMatches(bracket), tileBracketMatches(bracket)];
    expect(a).toEqual(b);

    const allTiledMatches = a.flatMap((t) => t.matches);
    expect(allTiledMatches).toHaveLength(bracket.matches.length);
    const uids = new Set(allTiledMatches.map((m) => m.matchUid));
    expect(uids.size).toBe(bracket.matches.length); // no duplicates across tiles
    expect([...uids].sort()).toEqual([...bracket.matches.map((m) => m.matchUid)].sort());
  });

  it('every early tile is a self-contained sub-bracket: its own slots are exactly the ones its matches trace back to', () => {
    const bracket = bracketFor(128);
    const tiles = tileBracketMatches(bracket);
    for (const tile of tiles.slice(0, -1)) {
      const slotPositions = new Set(tile.slots.map((s) => s.position));
      expect(slotPositions.size).toBeGreaterThan(0);
    }
  });

  it('the trailing tile references earlier chunk champions by match code, never a fabricated participant', () => {
    const bracket = bracketFor(128);
    const tiles = tileBracketMatches(bracket);
    const late = tiles.at(-1);
    expect(late?.slots).toHaveLength(0);
    for (const m of late?.matches ?? []) {
      if (m.feederA.kind === 'match') expect(m.feederA.matchUid).toBeTruthy();
      if (m.feederB.kind === 'match') expect(m.feederB.matchUid).toBeTruthy();
    }
  });

  it('preserves every BYE-heavy bracket slot even when small enough not to tile', () => {
    const bracket = bracketFor(5);
    const tiles = tileBracketMatches(bracket);
    expect(tiles[0]?.slots.filter((s) => s.isBye)).toHaveLength(3);
  });
});
