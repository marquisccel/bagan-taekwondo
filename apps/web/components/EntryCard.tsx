'use client';

import type { EntryDisplay } from '../lib/api';
import { humanizeCode } from '../lib/id-labels';

function fmtWeight(g: number | null): string | null {
  return g === null ? null : `${(g / 1000).toFixed(1).replace('.', ',')} kg`;
}
function fmtHeight(mm: number | null): string | null {
  return mm === null ? null : `${Math.round(mm / 10)} cm`;
}

/**
 * A pool's participant row (UX slice 0, §18) — compact, mostly borderless; hover/selected/drag
 * states come entirely from CSS classes, never inline color logic. "Tukar Peserta" is the operator
 * label for what the backend calls SwapEntries — the raw word "Swap" never appears in the UI.
 */
export function EntryCard({
  entry,
  draggable,
  selected = false,
  onOpenDetail,
  onMove,
  onSwap,
  onDragStart,
}: {
  entry: EntryDisplay;
  draggable: boolean;
  selected?: boolean;
  onOpenDetail: () => void;
  onMove?: () => void;
  onSwap?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const a = entry.athletes[0];
  return (
    <div
      className={`entry-card${selected ? ' selected' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      role="group"
      aria-label={`${entry.displayName}, ${entry.contingent}`}
      onClick={onOpenDetail}
    >
      {draggable ? <span className="entry-card-handle" aria-hidden="true" /> : null}
      <div className="entry-card-body">
        <div className="name">{entry.displayName}</div>
        <div className="meta">{entry.contingent}</div>
        <div className="meta">
          {[
            a?.beltLabel ?? (a?.beltCode ? humanizeCode(a.beltCode) : null),
            fmtHeight(a?.heightMm ?? null),
            fmtWeight(a?.weightG ?? null),
          ]
            .filter(Boolean)
            .join(' · ') || '·'}
        </div>
      </div>
      {draggable && (onMove || onSwap) ? (
        <div className="entry-card-actions">
          {onMove ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={(e) => {
                e.stopPropagation();
                onMove();
              }}
            >
              Pindahkan
            </button>
          ) : null}
          {onSwap ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
            >
              Tukar Peserta
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
