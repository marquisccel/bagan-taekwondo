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

  it('resolves round-1 entries through bracket_slot and shows BYE for an empty-but-marked slot', () => {
    const bracket = buildBracket(2);
    const withBye: Bracket = {
      ...bracket,
      slots: [
        bracket.slots[0]!,
        { ...bracket.slots[1]!, entry_id: null, entry: null, bye_reason: { code: 'ODD_COUNT' } },
      ],
    };
    render(<BracketView bracket={withBye} />);
    expect(screen.getByText(/Athlete 1/)).toBeInTheDocument();
    expect(screen.getByText('BYE')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
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
