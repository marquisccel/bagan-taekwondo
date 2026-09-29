import { useState } from 'react';

import type { Bracket, BracketMatch, MatchFeeder } from '../lib/api';

const genderWord = (g: string | null | undefined): string =>
  g === 'MALE' ? 'Putra' : g === 'FEMALE' ? 'Putri' : '·';

/**
 * Round 1 feeders resolve through bracket_slot (real names/details). A later round's own two
 * "slots" are whichever match feeds it -- already shown as its own nested subtree in the tree
 * layout below, so this is only ever called for round-1 leaves; the `kind === 'match'` branch is
 * dead in practice but kept as a defensive fallback rather than assuming the shape.
 */
function feederRow(
  feeder: MatchFeeder,
  bracket: Bracket,
): { idAtlet: string; label: string; entryId: string | null } | null {
  if (feeder.kind === 'match') return null;
  const slot = bracket.slots.find((s) => s.position === feeder.slot);
  if (!slot) return null;
  if (slot.entry) {
    const a = slot.entry.athletes[0];
    return {
      idAtlet: slot.entry.externalRef ?? '·',
      label: `${slot.entry.displayName} · ${genderWord(a?.gender)} · ${slot.entry.contingent}`,
      entryId: slot.entry.entryId,
    };
  }
  if (slot.bye_reason) return { idAtlet: '·', label: 'BYE', entryId: null };
  return null;
}

/**
 * The "nomor tampilan" (display number) is presentation-only (see match.display_no in
 * packages/db/src/schema/draw.ts) and never touches matchUid/publicCode — those internal codes
 * stay fixed for traceability regardless of what the team types here. Editable only while the
 * revision is DRAFT (`editable`); saved via SET_MATCH_DISPLAY_NO on blur/Enter.
 */
function DisplayNoField({
  match,
  editable,
  saving,
  onSave,
}: {
  match: BracketMatch;
  editable: boolean;
  saving: boolean;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(match.displayNo != null ? String(match.displayNo) : '');

  if (!editable) {
    if (match.displayNo != null) {
      return (
        <div className="match-display-no" title="Nomor tampilan (diisi manual)">
          {match.displayNo}
        </div>
      );
    }
    return match.resolvedDisplayNo != null ? (
      <div className="match-display-no match-display-no-auto" title="Nomor otomatis (belum diedit tim)">
        {match.resolvedDisplayNo}
      </div>
    ) : (
      <div className="match-display-no match-display-no-empty" title="Nomor belum diisi">
        No.
      </div>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (match.displayNo !== null) onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1) {
      setDraft(match.displayNo != null ? String(match.displayNo) : '');
      return;
    }
    if (n !== match.displayNo) onSave(n);
  };

  return (
    <input
      className="match-display-no-input"
      type="number"
      min={1}
      placeholder={match.resolvedDisplayNo != null ? String(match.resolvedDisplayNo) : 'No.'}
      value={draft}
      disabled={saving}
      aria-label={`Nomor tampilan untuk pertandingan ronde ${match.round} nomor urut ${match.position}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/**
 * A single vertex in the bracket-line tree: round-1 leaves show the two real names it pairs up
 * (from bracket_slot); every other round shows only the print number, since its two "sides" are
 * already the nested subtree drawn to its left — matching a printed bracket sheet, which never
 * repeats a name once it has advanced past round 1, and never shows an internal id/hash.
 */
function MatchVertex({
  match,
  bracket,
  isLeaf,
  editable,
  savingMatchId,
  onSetDisplayNo,
  onSwapEntries,
}: {
  match: BracketMatch;
  bracket: Bracket;
  isLeaf: boolean;
  editable: boolean;
  savingMatchId: string | null;
  onSetDisplayNo?: (matchId: string, displayNo: number | null) => void;
  onSwapEntries?: (entryIdA: string, entryIdB: string) => void;
}) {
  const rowA = isLeaf ? feederRow(match.feederA, bracket) : null;
  const rowB = isLeaf ? feederRow(match.feederB, bracket) : null;
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const canDrag = isLeaf && editable && !!onSwapEntries;
  return (
    <div className="bracket-vertex">
      {isLeaf ? (
        <div className="bracket-names">
          {[rowA, rowB].map((r, i) => (
            <div
              className={`bracket-name-row${dragOverIdx === i ? ' bracket-name-row-over' : ''}`}
              key={i}
              draggable={canDrag && !!r?.entryId}
              onDragStart={(e) => {
                if (r?.entryId) e.dataTransfer.setData('text/entry-id', r.entryId);
              }}
              onDragOver={(e) => {
                if (!canDrag || !r?.entryId) return;
                e.preventDefault();
                setDragOverIdx(i);
              }}
              onDragLeave={() => setDragOverIdx((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                if (!canDrag || !r?.entryId) return;
                e.preventDefault();
                setDragOverIdx(null);
                const draggedId = e.dataTransfer.getData('text/entry-id');
                if (draggedId && draggedId !== r.entryId) onSwapEntries?.(draggedId, r.entryId);
              }}
            >
              {r ? (
                <>
                  <code className="bracket-name-id">{r.idAtlet}</code>
                  <span className="bracket-name-sep" aria-hidden="true" />
                  <span className="bracket-name-label">{r.label}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {onSetDisplayNo ? (
        <DisplayNoField
          match={match}
          editable={editable}
          saving={savingMatchId === match.id}
          onSave={(value) => onSetDisplayNo(match.id, value)}
        />
      ) : null}
    </div>
  );
}

/**
 * A real bracket-line tree (per the team's request to match their printed bracket sheet) instead of
 * plain per-round columns: built recursively from the final match down to round 1, so every match
 * visually connects to the two it was fed by via a bracket-shaped CSS connector
 * (`.bracket-children::before`). There is exactly one match at the highest round in a single pool's
 * bracket, so recursion starts there.
 */
function BracketNode({
  round,
  position,
  minRound,
  matchByKey,
  bracket,
  editable,
  savingMatchId,
  onSetDisplayNo,
  onSwapEntries,
}: {
  round: number;
  position: number;
  minRound: number;
  matchByKey: ReadonlyMap<string, BracketMatch>;
  bracket: Bracket;
  editable: boolean;
  savingMatchId: string | null;
  onSetDisplayNo?: (matchId: string, displayNo: number | null) => void;
  onSwapEntries?: (entryIdA: string, entryIdB: string) => void;
}) {
  const match = matchByKey.get(`${round}-${position}`);
  if (!match) return null;
  const vertex = (
    <MatchVertex
      match={match}
      bracket={bracket}
      isLeaf={round === minRound}
      editable={editable}
      savingMatchId={savingMatchId}
      onSetDisplayNo={onSetDisplayNo}
      onSwapEntries={onSwapEntries}
    />
  );
  if (round === minRound) return vertex;
  return (
    <div className="bracket-node">
      <div className="bracket-children">
        <BracketNode
          round={round - 1}
          position={position * 2 - 1}
          minRound={minRound}
          matchByKey={matchByKey}
          bracket={bracket}
          editable={editable}
          savingMatchId={savingMatchId}
          onSetDisplayNo={onSetDisplayNo}
          onSwapEntries={onSwapEntries}
        />
        <BracketNode
          round={round - 1}
          position={position * 2}
          minRound={minRound}
          matchByKey={matchByKey}
          bracket={bracket}
          editable={editable}
          savingMatchId={savingMatchId}
          onSetDisplayNo={onSetDisplayNo}
          onSwapEntries={onSwapEntries}
        />
      </div>
      {vertex}
    </div>
  );
}

export function BracketView({
  bracket,
  editable = false,
  savingMatchId = null,
  onSetDisplayNo,
  onSwapEntries,
}: {
  bracket: Bracket;
  editable?: boolean;
  savingMatchId?: string | null;
  onSetDisplayNo?: (matchId: string, displayNo: number | null) => void;
  /** Drag one round-1 athlete's row onto another's to swap their bracket slots (SwapEntry command). */
  onSwapEntries?: (entryIdA: string, entryIdB: string) => void;
}) {
  if (bracket.matches.length === 0) {
    return <p style={{ color: 'var(--text-dim)' }}>No matches (single entry or fully walkover pool).</p>;
  }
  const rounds = [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b);
  const minRound = rounds[0] as number;
  const maxRound = rounds[rounds.length - 1] as number;
  const matchByKey = new Map(bracket.matches.map((m) => [`${m.round}-${m.position}`, m]));

  return (
    <div className="bracket-scroll">
      <div className="bracket-tree">
        <BracketNode
          round={maxRound}
          position={1}
          minRound={minRound}
          matchByKey={matchByKey}
          bracket={bracket}
          editable={editable}
          savingMatchId={savingMatchId}
          onSetDisplayNo={onSetDisplayNo}
          onSwapEntries={onSwapEntries}
        />
      </div>
    </div>
  );
}
