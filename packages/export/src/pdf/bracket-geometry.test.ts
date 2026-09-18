import { describe, expect, it } from 'vitest';

import { makeFixtureModel } from '../testing/fixtures.js';
import { computeBracketGeometry } from './bracket-geometry.js';

function bracketFor(n: number) {
  const model = makeFixtureModel({ participantCount: n });
  const bracket = model.categories[0]?.pools[0]?.bracket;
  if (!bracket) throw new Error('fixture has no bracket');
  return bracket;
}

describe('computeBracketGeometry (visual bracket — ACCEPTANCE §4)', () => {
  it('contains every persisted match, not a recomputed subset', () => {
    for (const n of [1, 2, 3, 4, 8, 16, 32, 64, 128]) {
      const bracket = bracketFor(n);
      const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
      expect(geometry.matches).toHaveLength(bracket.matches.length);
      const uids = new Set(geometry.matches.map((m) => m.match.matchUid));
      expect(uids.size).toBe(bracket.matches.length);
    }
  });

  it("a match's y is exactly the midpoint of its two real feeders — the feeder graph is read, never re-derived", () => {
    const bracket = bracketFor(8);
    const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
    const round1 = geometry.matches.filter((m) => m.match.round === 1);
    for (const node of round1) {
      expect(node.y).toBeCloseTo((node.feederAY + node.feederBY) / 2, 6);
    }
    const yByUid = new Map(geometry.matches.map((m) => [m.match.matchUid, m.y]));
    const round2 = geometry.matches.filter((m) => m.match.round === 2);
    expect(round2.length).toBeGreaterThan(0);
    for (const node of round2) {
      // A round-2 match's feeder y's must equal the EXACT y already computed for the specific
      // round-1 match it is fed by (read from the real feeder graph, not assumed by position).
      expect(node.match.feederA.kind).toBe('match');
      expect(node.match.feederB.kind).toBe('match');
      if (node.match.feederA.kind === 'match')
        expect(node.feederAY).toBe(yByUid.get(node.match.feederA.matchUid));
      if (node.match.feederB.kind === 'match')
        expect(node.feederBY).toBe(yByUid.get(node.match.feederB.matchUid));
      expect(node.y).toBeCloseTo((node.feederAY + node.feederBY) / 2, 6);
    }
  });

  it('marks an empty round-1 slot as BYE, never a fabricated participant', () => {
    const bracket = bracketFor(5); // size 8, 3 BYEs
    const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
    const byeLeaves = geometry.leaves.filter((l) => l.isBye);
    expect(byeLeaves).toHaveLength(3);
    for (const l of byeLeaves) expect(l.label).toBe('BYE');
  });

  it('is a pure function: identical input produces identical geometry', () => {
    const bracket = bracketFor(16);
    const a = computeBracketGeometry(bracket.matches, bracket.slots);
    const b = computeBracketGeometry(bracket.matches, bracket.slots);
    expect(a).toEqual(b);
  });

  it('renders a virtual "Pemenang <code>" leaf when a feeder match is not included in the given subset', () => {
    const bracket = bracketFor(8);
    const round1 = bracket.matches.filter((m) => m.round === 1);
    const laterRounds = bracket.matches.filter((m) => m.round > 1);
    // Give the geometry only the later rounds, as bracket-tiling.ts does for its "late" tile.
    const geometry = computeBracketGeometry(laterRounds, []);
    const virtualLeaves = geometry.leaves.filter((l) => l.isVirtual);
    expect(virtualLeaves.length).toBeGreaterThan(0);
    for (const l of virtualLeaves) {
      expect(l.label).toMatch(/^Pemenang /);
      const referencedCode = l.label.replace('Pemenang ', '');
      expect(round1.some((m) => m.publicCode === referencedCode)).toBe(true);
    }
  });
});
