'use client';

import type { EntryDisplay } from '../lib/api';

function fmtWeight(g: number | null): string | null {
  return g === null ? null : `${(g / 1000).toFixed(1)}kg`;
}
function fmtHeight(mm: number | null): string | null {
  return mm === null ? null : `${Math.round(mm / 10)}cm`;
}

export function EntryCard({
  entry,
  draggable,
  onOpenDetail,
  onMove,
  onSwap,
  onDragStart,
}: {
  entry: EntryDisplay;
  draggable: boolean;
  onOpenDetail: () => void;
  onMove?: () => void;
  onSwap?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const a = entry.athletes[0];
  return (
    <div
      className="entry-card"
      draggable={draggable}
      onDragStart={onDragStart}
      role="group"
      aria-label={`${entry.displayName}, ${entry.contingent}`}
    >
      <div className="name">{entry.displayName}</div>
      <div className="meta">{entry.contingent}</div>
      <div className="meta">
        {[a?.gender, fmtWeight(a?.weightG ?? null), fmtHeight(a?.heightMm ?? null), a?.beltCode]
          .filter(Boolean)
          .join(' · ') || '—'}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button
          type="button"
          className="btn"
          style={{ padding: '2px 8px', fontSize: 11 }}
          onClick={onOpenDetail}
        >
          Detail
        </button>
        {draggable && onMove ? (
          <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={onMove}>
            Move…
          </button>
        ) : null}
        {draggable && onSwap ? (
          <button type="button" className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={onSwap}>
            Swap…
          </button>
        ) : null}
      </div>
    </div>
  );
}
