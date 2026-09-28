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
  it('contains every persisted REAL match, not a recomputed subset (official bracket structure) -- a WALKOVER pairing is never drawn as a match box', () => {
    for (const n of [1, 2, 3, 4, 8, 16, 32, 64, 128]) {
      const bracket = bracketFor(n);
      const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
      const realMatches = bracket.matches.filter((m) => m.status !== 'WALKOVER');
      expect(geometry.matches).toHaveLength(realMatches.length);
      const uids = new Set(geometry.matches.map((m) => m.match.matchUid));
      expect(uids.size).toBe(realMatches.length);
      // Every WALKOVER match still resolves to a y (the advancing feeder's own row), so a downstream
      // real match that references it lines up correctly -- it's just never its own drawn node.
      for (const m of bracket.matches.filter((m) => m.status === 'WALKOVER')) {
        expect(uids.has(m.matchUid)).toBe(false);
      }
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

  it('never creates a leaf for a bye slot (official bracket structure) -- a WALKOVER match is collapsed away entirely, so the advancing participant is the only thing ever drawn in its place', () => {
    // n=1 has no matches at all (size 1, nothing to feed a leaf), so it's excluded from the "one
    // leaf per real entry" check but still trivially has zero BYE leaves.
    for (const n of [1, 2, 3, 4, 5, 8]) {
      const bracket = bracketFor(n);
      const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
      expect(geometry.leaves.filter((l) => l.isBye)).toHaveLength(0);
      if (n > 1) expect(geometry.leaves).toHaveLength(n);
    }
  });

  it('a WALKOVER match resolves to exactly the advancing (non-bye) feeder — it is never re-derived from position or seed order', () => {
    const bracket = bracketFor(3); // size 4, 1 BYE, 1 WALKOVER match in round 1
    const walkover = bracket.matches.find((m) => m.status === 'WALKOVER');
    expect(walkover).toBeDefined();
    if (!walkover) return;
    const realSlot = bracket.slots.find(
      (s) =>
        !s.isBye &&
        ((walkover.feederA.kind === 'slot' && walkover.feederA.slot === s.position) ||
          (walkover.feederB.kind === 'slot' && walkover.feederB.slot === s.position)),
    );
    expect(realSlot).toBeDefined();
    const geometry = computeBracketGeometry(bracket.matches, bracket.slots);
    const advancingLeaf = geometry.leaves.find((l) => l.key === `slot:${realSlot?.position}`);
    expect(advancingLeaf).toBeDefined();
    expect(advancingLeaf?.label).toBe(realSlot?.entry?.displayName);
    // Any real match feeding from this WALKOVER's uid must land on exactly that leaf's y.
    const final = bracket.matches.find(
      (m) =>
        m.status !== 'WALKOVER' &&
        ((m.feederA.kind === 'match' && m.feederA.matchUid === walkover.matchUid) ||
          (m.feederB.kind === 'match' && m.feederB.matchUid === walkover.matchUid)),
    );
    expect(final).toBeDefined();
    const finalNode = geometry.matches.find((m) => m.match.matchUid === final?.matchUid);
    expect(finalNode).toBeDefined();
    const feederYUsed =
      final?.feederA.kind === 'match' && final.feederA.matchUid === walkover.matchUid
        ? finalNode?.feederAY
        : finalNode?.feederBY;
    expect(feederYUsed).toBe(advancingLeaf?.y);
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
