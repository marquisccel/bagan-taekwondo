import { useLayoutEffect, useRef, useState } from 'react';

import type { Bracket, BracketMatch, MatchFeeder } from '../lib/api';

const genderWord = (g: string | null | undefined): string =>
  g === 'MALE' ? 'Putra' : g === 'FEMALE' ? 'Putri' : '·';

/**
 * Round 1 feeders resolve through bracket_slot (real names/details). A later round's own two
 * "slots" are whichever match feeds it -- already shown as its own nested subtree in the tree
 * layout below, so this is only ever called for round-1 leaves; the `kind === 'match'` branch is
 * dead in practice but kept as a defensive fallback rather than assuming the shape.
 */
interface FeederRow {
  readonly idAtlet: string;
  readonly nama: string;
  readonly kelamin: string;
  readonly kontingen: string;
  readonly entryId: string | null;
}

function feederRow(feeder: MatchFeeder, bracket: Bracket): FeederRow | null {
  if (feeder.kind === 'match') return null;
  const slot = bracket.slots.find((s) => s.position === feeder.slot);
  if (!slot) return null;
  if (slot.entry) {
    const a = slot.entry.athletes[0];
    return {
      idAtlet: slot.entry.externalRef ?? '·',
      nama: slot.entry.displayName,
      kelamin: genderWord(a?.gender),
      kontingen: slot.entry.contingent,
      entryId: slot.entry.entryId,
    };
  }
  if (slot.bye_reason) return { idAtlet: '·', nama: 'BYE', kelamin: '·', kontingen: '·', entryId: null };
  return null;
}

/** Shown as their own columns on every round-1 row (Divisi, Class), matching the committee's
 * printed reference table -- every row in one BracketView is already the same category, so these
 * are the same strings repeated down the column, not looked up per entry. */
interface CategoryLabels {
  readonly divisi: string;
  readonly kelas: string;
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
  categoryLabels,
  onSetDisplayNo,
  onSwapEntries,
}: {
  match: BracketMatch;
  bracket: Bracket;
  isLeaf: boolean;
  editable: boolean;
  savingMatchId: string | null;
  categoryLabels?: CategoryLabels;
  onSetDisplayNo?: (matchId: string, displayNo: number | null) => void;
  onSwapEntries?: (entryIdA: string, entryIdB: string) => void;
}) {
  const rowA = isLeaf ? feederRow(match.feederA, bracket) : null;
  const rowB = isLeaf ? feederRow(match.feederB, bracket) : null;
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const canDrag = isLeaf && editable && !!onSwapEntries;
  return (
    <div className="bracket-vertex" data-match-key={`${match.round}-${match.position}`}>
      {isLeaf ? (
        <div className="bracket-names">
          {[rowA, rowB].map((r, i) => (
            <div
              className={`bracket-name-row${dragOverIdx === i ? ' bracket-name-row-over' : ''}`}
              key={i}
              data-row-key={`${match.round}-${match.position}-${i}`}
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
                  <span className="bracket-name-nama">{r.nama}</span>
                  <span className="bracket-name-kelamin">{r.kelamin}</span>
                  <span className="bracket-name-divisi">
                    {r.nama === 'BYE' ? '' : (categoryLabels?.divisi ?? '·')}
                  </span>
                  <span className="bracket-name-kelas">
                    {r.nama === 'BYE' ? '' : (categoryLabels?.kelas ?? '·')}
                  </span>
                  <span className="bracket-name-kontingen">{r.kontingen}</span>
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
 * visually connects to the two it was fed by. The connecting lines themselves are drawn separately,
 * on <canvas> -- see useBracketLines below. There is exactly one match at the highest round in a
 * single pool's bracket, so recursion starts there.
 */
function BracketNode({
  round,
  position,
  minRound,
  matchByKey,
  bracket,
  editable,
  savingMatchId,
  categoryLabels,
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
  categoryLabels?: CategoryLabels;
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
      categoryLabels={categoryLabels}
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
          categoryLabels={categoryLabels}
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
          categoryLabels={categoryLabels}
          onSetDisplayNo={onSetDisplayNo}
          onSwapEntries={onSwapEntries}
        />
      </div>
      {vertex}
    </div>
  );
}

/** A point on the canvas, relative to the `.bracket-tree` container. */
interface LinePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Draws every connecting line of the bracket tree on a `<canvas>` overlaid on `.bracket-tree`,
 * instead of CSS border tricks on each node -- a canvas line is drawn at an exact measured pixel
 * position regardless of how wide the tree gets or how far apart two matches end up, which a
 * per-element CSS connector can't guarantee once names are long and the tree is deliberately
 * stretched wide (see .bracket-names). Re-measures and redraws on every resize of the tree itself
 * (a ResizeObserver, not just a window resize listener -- the tree's own size can change from its
 * content, e.g. a longer name set, without the window changing at all).
 *
 * Walks the exact same match tree BracketNode renders (round, position -> its two (round-1) children,
 * or its two leaf name rows at minRound), reading each one's live position from the DOM via the
 * `data-match-key`/`data-row-key` attributes MatchVertex renders. A child's own "output" point is its
 * vertex's right edge; a parent's "input" point is its vertex's left edge -- the same visual joint a
 * printed bracket sheet draws, one elbow per match.
 */
function useBracketLines(
  treeRef: React.RefObject<HTMLDivElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  matches: readonly BracketMatch[],
  minRound: number,
  maxRound: number,
) {
  useLayoutEffect(() => {
    const tree = treeRef.current;
    const canvas = canvasRef.current;
    if (!tree || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const matchByKey = new Map(matches.map((m) => [`${m.round}-${m.position}`, m]));
    const lineColor =
      getComputedStyle(document.documentElement).getPropertyValue('--bracket-line').trim() || '#0f172a';

    const pointOf = (el: Element): { left: LinePoint; right: LinePoint; bottomRight: LinePoint } => {
      const r = el.getBoundingClientRect();
      const treeRect = tree.getBoundingClientRect();
      const y = r.top - treeRect.top + r.height / 2;
      const yBottom = r.bottom - treeRect.top;
      return {
        left: { x: r.left - treeRect.left, y },
        right: { x: r.right - treeRect.left, y },
        // A name row now has its own underline (see .bracket-name-row's border-bottom) -- the line
        // feeding out of it should visibly start FROM that underline, not float at the row's vertical
        // center above it.
        bottomRight: { x: r.right - treeRect.left, y: yBottom },
      };
    };

    /** The full bracket elbow: two inputs merge onto a vertical spine a few pixels out, then one line
     * continues from the spine all the way to the target -- the match's own "No." field, found
     * directly rather than assumed from the vertex's own bounding box, since a LEAF vertex's box also
     * contains `.bracket-names` (so the vertex's own left edge is the names' left edge, nowhere near
     * the number). Reaching the number itself, not just stopping in the gap before it, is what makes
     * this read as one continuous line into "1"/"2"/etc. instead of a line that stops short of it.
     *
     * Every point here comes straight from a real measured DOM edge (a row's own underline, a
     * vertex's own right edge) -- snapping those coordinates to a half-pixel for a "crisper" canvas
     * stroke was tried and reverted, because it moved the line's endpoint away from the CSS border's
     * actual sub-pixel position, breaking the visual join right where the line is supposed to touch
     * it (looked "patah"/disconnected exactly at that seam). Matching the real measured position
     * exactly matters more than stroke crispness. */
    const connect = (a: LinePoint, b: LinePoint, target: LinePoint) => {
      // The spine sits a little further TOWARD the target than the inputs, never behind them --
      // `a.x - 10` was backwards (it walked left, back over the names/number it just came from,
      // instead of right, out toward the target it's actually heading for).
      const spineX = a.x + 10;
      // One single vertical spine spanning everything it needs to reach (a, b, AND target.y), drawn
      // exactly once -- drawing it in more than one overlapping stroke (an earlier version drew the
      // a-to-b span and then a second, mostly-overlapping target-covering span) doubled up the
      // anti-aliasing at the shared pixels and showed up as a stray extra tick at the corner.
      // The final segment continues from the spine's own vertical MIDDLE -- not from its top or
      // bottom -- straight into the target, so the "]" always has its horizontal exit centered on
      // its own elbow, never offset to one end of it.
      const spineTop = Math.min(a.y, b.y, target.y);
      const spineBottom = Math.max(a.y, b.y, target.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(spineX, a.y);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(spineX, b.y);
      ctx.moveTo(spineX, spineTop);
      ctx.lineTo(spineX, spineBottom);
      ctx.moveTo(spineX, target.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    };

    const numberFieldOf = (vertexEl: Element): Element | null =>
      vertexEl.querySelector('[class*="match-display-no"]');

    const numberFieldPoint = (vertexEl: Element, fallback: LinePoint): LinePoint => {
      const numberEl = numberFieldOf(vertexEl);
      return numberEl ? pointOf(numberEl).left : fallback;
    };

    /**
     * Every vertex's pill naturally centers against its OWN flex box -- correct for a round-2+
     * vertex (whose box is just the pill itself, nothing else), but NOT for a leaf vertex, whose box
     * also contains the two name rows: for two equal-height rows that centers the pill exactly on the
     * boundary between them, half a row short of the actual midpoint between their two underlines,
     * which is where a line from each underline must visually meet. That mismatch then keeps
     * propagating upward -- once a leaf's own output point moves to its true center, a round-2+
     * vertex's two inputs are no longer symmetric around ITS OWN natural (still unmoved) pill
     * position either.
     *
     * So every vertex here, leaf or not, is nudged (via a transform, reset every redraw below) from
     * its natural position onto the true midpoint of its own two inputs -- whatever they are -- and
     * reports THAT adjusted position upward as its own output point, so the correction is never lost
     * one level up the tree.
     */
    const visit = (round: number, position: number): LinePoint | null => {
      const match = matchByKey.get(`${round}-${position}`);
      if (!match) return null;
      const vertexEl = tree.querySelector(`[data-match-key="${round}-${position}"]`);
      if (!vertexEl) return null;
      const v = pointOf(vertexEl);
      const target = numberFieldPoint(vertexEl, v.left);
      let a: LinePoint | null;
      let b: LinePoint | null;
      if (round === minRound) {
        const row0 = tree.querySelector(`[data-row-key="${round}-${position}-0"]`);
        const row1 = tree.querySelector(`[data-row-key="${round}-${position}-1"]`);
        // `.bracket-name-row` stretches to fill `.bracket-names`' full width (a flex column's default
        // cross-axis stretch), so each row's own right edge already sits at that container's right
        // edge regardless of the name's actual length -- exactly the convergence point this pair's
        // lines need. Each line starts from its own row's underline (bottomRight), not the row's
        // vertical middle.
        a = row0 ? pointOf(row0).bottomRight : null;
        b = row1 ? pointOf(row1).bottomRight : null;
      } else {
        a = visit(round - 1, position * 2 - 1);
        b = visit(round - 1, position * 2);
      }
      if (!a || !b) return v.right;
      const trueCenter = (a.y + b.y) / 2;
      const numberEl = numberFieldOf(vertexEl);
      if (numberEl) (numberEl as HTMLElement).style.transform = `translateY(${trueCenter - target.y}px)`;
      connect(a, b, { x: target.x, y: trueCenter });
      return { x: v.right.x, y: trueCenter };
    };

    const draw = () => {
      // Reset every leaf pill's nudge before re-measuring -- otherwise each redraw would compute its
      // offset against the PREVIOUS redraw's already-nudged position and the shift would compound.
      tree.querySelectorAll('[class*="match-display-no"]').forEach((el) => {
        (el as HTMLElement).style.transform = '';
      });
      const rect = tree.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      // Drawn on <canvas> rather than left as each row's own CSS border-bottom, so the underline
      // renders with the exact same stroke (color, width, anti-aliasing) as the elbow lines it joins
      // -- a CSS border and a canvas stroke render crisp-vs-anti-aliased differently even at the same
      // nominal color/width, which looked like a visible "patah" (break) right where a connector
      // line met the underline it's supposed to continue from.
      const treeRect = tree.getBoundingClientRect();
      tree.querySelectorAll('.bracket-name-row').forEach((rowEl) => {
        const r = rowEl.getBoundingClientRect();
        const y = r.bottom - treeRect.top;
        ctx.beginPath();
        ctx.moveTo(r.left - treeRect.left, y);
        ctx.lineTo(r.right - treeRect.left, y);
        ctx.stroke();
      });
      visit(maxRound, 1);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(tree);
    return () => ro.disconnect();
  }, [treeRef, canvasRef, matches, minRound, maxRound]);
}

export function BracketView({
  bracket,
  editable = false,
  savingMatchId = null,
  categoryLabels,
  onSetDisplayNo,
  onSwapEntries,
}: {
  bracket: Bracket;
  editable?: boolean;
  savingMatchId?: string | null;
  categoryLabels?: CategoryLabels;
  onSetDisplayNo?: (matchId: string, displayNo: number | null) => void;
  /** Drag one round-1 athlete's row onto another's to swap their bracket slots (SwapEntry command). */
  onSwapEntries?: (entryIdA: string, entryIdB: string) => void;
}) {
  const treeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hasMatches = bracket.matches.length > 0;
  const rounds = hasMatches ? [...new Set(bracket.matches.map((m) => m.round))].sort((a, b) => a - b) : [];
  const minRound = rounds[0] ?? 0;
  const maxRound = rounds[rounds.length - 1] ?? 0;
  const matchByKey = new Map(bracket.matches.map((m) => [`${m.round}-${m.position}`, m]));

  useBracketLines(treeRef, canvasRef, bracket.matches, minRound, maxRound);

  if (!hasMatches) {
    return <p style={{ color: 'var(--text-dim)' }}>No matches (single entry or fully walkover pool).</p>;
  }

  return (
    <div className="bracket-scroll">
      <div className="bracket-tree" ref={treeRef}>
        <canvas className="bracket-lines-canvas" ref={canvasRef} aria-hidden="true" />
        <BracketNode
          round={maxRound}
          position={1}
          minRound={minRound}
          matchByKey={matchByKey}
          bracket={bracket}
          editable={editable}
          savingMatchId={savingMatchId}
          categoryLabels={categoryLabels}
          onSetDisplayNo={onSetDisplayNo}
          onSwapEntries={onSwapEntries}
        />
      </div>
    </div>
  );
}
