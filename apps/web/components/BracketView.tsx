import type { Bracket, MatchFeeder } from '../lib/api';

/**
 * Renders exactly the persisted bracket/bracket_slot/match rows — no client-side bracket
 * structure invention (ACCEPTANCE §BRACKET VIEW). Round 1 feeders resolve through bracket_slot;
 * later rounds show "winner of <public code>" since match results don't exist without live
 * scoring (explicitly out of Phase 5 scope).
 */
function feederLabel(feeder: MatchFeeder, bracket: Bracket): string {
  if (feeder.kind === 'match')
    return feeder.publicCode ? `Winner of ${feeder.publicCode}` : 'Winner of previous match';
  const slot = bracket.slots.find((s) => s.position === feeder.slot);
  if (!slot) return `Slot ${feeder.slot}`;
  if (slot.entry) return slot.entry.displayName;
  if (slot.bye_reason) return 'BYE';
  return 'Empty slot';
}

export function BracketView({ bracket }: { bracket: Bracket }) {
  if (bracket.matches.length === 0) {
    return <p style={{ color: 'var(--text-dim)' }}>No matches (single entry or fully walkover pool).</p>;
  }
  const rounds = [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b);

  return (
    <div className="bracket-scroll">
      <div className="bracket">
        {rounds.map((round) => (
          <div key={round} className="bracket-round">
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-dim)',
                fontSize: 11,
                textTransform: 'uppercase',
              }}
            >
              Round {round}
            </div>
            {bracket.matches
              .filter((m) => m.round === round)
              .sort((a, b) => a.position - b.position)
              .map((m) => (
                <div key={m.id} className="bracket-match">
                  <div className="code">{m.publicCode ?? m.matchUid.slice(0, 8)}</div>
                  <div>{feederLabel(m.feederA, bracket)}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>vs</div>
                  <div>{feederLabel(m.feederB, bracket)}</div>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
