import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Bracket, BracketMatch } from '../lib/api';
import { BracketView } from './BracketView';

/** Builds a full power-of-two bracket of `size` slots with round-1 real entries and later rounds
 * feeding from the previous round's matches — the same shape draw-run-repository.ts persists. */
function buildBracket(size: number): Bracket {
  const rounds = Math.log2(size);
  const slots = Array.from({ length: size }, (_, i) => ({
    position: i + 1,
    entry_id: `e${i + 1}`,
    seed_no: i + 1,
    bye_reason: null,
    entry: {
      entryId: `e${i + 1}`,
      externalRef: `R${i + 1}`,
      contingent: `Kota ${i + 1}`,
      displayName: `Athlete ${i + 1}`,
      athletes: [],
    },
  }));
  const matches: BracketMatch[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round;
    for (let position = 1; position <= count; position += 1) {
      matches.push({
        id: `m${round}-${position}`,
        matchUid: `uid-${round}-${position}`,
        round,
        position,
        publicCode: `A${String((round - 1) * count + position).padStart(3, '0')}`,
        displayNo: null,
        resolvedDisplayNo: (round - 1) * count + position,
        status: 'PENDING',
        feederA:
          round === 1
            ? { kind: 'slot', slot: position * 2 - 1 }
            : { kind: 'match', publicCode: `A${round - 1}` },
        feederB:
          round === 1 ? { kind: 'slot', slot: position * 2 } : { kind: 'match', publicCode: `A${round - 1}` },
      });
    }
  }
  return { id: 'b1', size, rounds, entries: size, byes: 0, slots, matches };
}

describe('BracketView', () => {
  it('renders every match, connected round to round as a bracket tree, for a large (64-entry) bracket without crashing', () => {
    const bracket = buildBracket(64);
    render(<BracketView bracket={bracket} />);
    // 32 + 16 + 8 + 4 + 2 + 1 = 63 matches total.
    expect(document.querySelectorAll('.bracket-vertex')).toHaveLength(63);
    // Every match past round 1 (16+8+4+2+1 = 31) is a branch node connecting two children via a
    // ".bracket-children" bracket-line connector -- confirming the tree, not flat round columns.
    expect(document.querySelectorAll('.bracket-node')).toHaveLength(31);
    expect(document.querySelectorAll('.bracket-children')).toHaveLength(31);
  });

  it('a genuine bye pairing (a real entry with no opponent at all) renders only the real entry, no BYE placeholder row and no "No." field of its own', () => {
    // A realistic shape: a 3-real-entry pool padded to 4 slots, so round-1 match 1 is a bye
    // (e1 vs nobody) while round-1 match 2 and the round-2 final are ordinary played matches.
    const bracket = buildBracket(4);
    const walkover: Bracket = {
      ...bracket,
      matches: bracket.matches.map((m) =>
        m.round === 1 && m.position === 1 ? { ...m, status: 'WALKOVER' } : m,
      ),
      slots: bracket.slots.map((s) =>
        s.position === 2 ? { ...s, entry_id: null, entry: null, bye_reason: { code: 'ODD_COUNT' } } : s,
      ),
    };
    render(<BracketView bracket={walkover} onSetDisplayNo={() => {}} />);
    expect(screen.getByText(/Athlete 1/)).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.queryByText('BYE')).not.toBeInTheDocument();
    // Only one name row is rendered for the bye match (the real entry), not a boxed pair.
    expect(document.querySelectorAll('[data-row-key^="1-1-"]')).toHaveLength(1);
    // No "No." field for a match nobody actually played -- the real entry's line runs straight
    // through into the match it actually plays instead.
    expect(document.querySelector('[data-match-key="1-1"] [class*="match-display-no"]')).toBeNull();
    // The real, played final still gets its own "No." field as usual.
    expect(document.querySelector('[data-match-key="2-1"] [class*="match-display-no"]')).not.toBeNull();
    // The bye match (1-1) reads as "sat out this round" -- it renders BELOW the real pairing (1-2)
    // regardless of its raw engine-assigned position, matching the printed PDF sheet's own ordering.
    const order = [...document.querySelectorAll('[data-match-key^="1-"]')].map((el) =>
      el.getAttribute('data-match-key'),
    );
    expect(order).toEqual(['1-2', '1-1']);
  });

  it('shows "no matches" for a walkover/single-entry pool instead of an empty bracket', () => {
    render(
      <BracketView bracket={{ id: 'b2', size: 1, rounds: 0, entries: 1, byes: 0, slots: [], matches: [] }} />,
    );
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('dragging one round-1 athlete row onto another calls onSwapEntries with both entry ids, only when editable', () => {
    const bracket = buildBracket(4);
    const onSwapEntries = vi.fn();
    render(<BracketView bracket={bracket} editable onSwapEntries={onSwapEntries} />);

    const rowA = screen.getByText(/Athlete 1/).closest('.bracket-name-row')!;
    const rowB = screen.getByText(/Athlete 3/).closest('.bracket-name-row')!;
    const dataTransfer = { getData: vi.fn().mockReturnValue('e1'), setData: vi.fn() };
    fireEvent.dragStart(rowA, { dataTransfer });
    fireEvent.drop(rowB, { dataTransfer });

    expect(onSwapEntries).toHaveBeenCalledWith('e1', 'e3');
  });

  it('never wires drag-and-drop when read-only (revision is not DRAFT)', () => {
    const bracket = buildBracket(4);
    const onSwapEntries = vi.fn();
    render(<BracketView bracket={bracket} editable={false} onSwapEntries={onSwapEntries} />);

    const rowA = screen.getByText(/Athlete 1/).closest('.bracket-name-row')!;
    expect(rowA).toHaveAttribute('draggable', 'false');
  });
});
