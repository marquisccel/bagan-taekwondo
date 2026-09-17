import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
  it('renders every round and every match for a large (64-entry) bracket without crashing', () => {
    const bracket = buildBracket(64);
    render(<BracketView bracket={bracket} />);
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('Round 6')).toBeInTheDocument();
    // 32 + 16 + 8 + 4 + 2 + 1 = 63 matches total.
    expect(document.querySelectorAll('.bracket-match')).toHaveLength(63);
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
    expect(screen.getByText('Athlete 1')).toBeInTheDocument();
    expect(screen.getByText('BYE')).toBeInTheDocument();
  });

  it('shows "no matches" for a walkover/single-entry pool instead of an empty bracket', () => {
    render(
      <BracketView bracket={{ id: 'b2', size: 1, rounds: 0, entries: 1, byes: 0, slots: [], matches: [] }} />,
    );
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
