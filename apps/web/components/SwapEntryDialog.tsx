'use client';

import type { EntryDisplay, PoolDetail } from '../lib/api';

/** Keyboard-accessible alternative to drag-and-drop for SwapEntries (ACCEPTANCE §ACCESSIBILITY). */
export function SwapEntryDialog({
  entry,
  pools,
  onPick,
  onCancel,
}: {
  entry: EntryDisplay;
  pools: readonly PoolDetail[];
  onPick: (otherEntryId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="drawer-overlay" onClick={onCancel}>
      <div
        className="drawer"
        role="dialog"
        aria-label={`Tukar Peserta ${entry.displayName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Tukar {entry.displayName} dengan…</h2>
        {pools.map((p) => (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 4 }}>Pool {p.ordinal}</div>
            {p.members
              .filter((m) => m.entryId !== entry.entryId)
              .map((m) => (
                <button
                  key={m.entryId}
                  type="button"
                  className="btn"
                  style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                  onClick={() => onPick(m.entryId)}
                >
                  {m.displayName} ({m.contingent})
                </button>
              ))}
          </div>
        ))}
        <button type="button" className="btn" onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}
